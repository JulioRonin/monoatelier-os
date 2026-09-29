import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import BannerFacturacion from './components/BannerFacturacion';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Financials from './pages/Financials';
import ClientPortal from './pages/ClientPortal';
import ProjectInitialization from './pages/ProjectInitialization';
import ProjectDetails from './pages/ProjectDetails';
import Quotes from './pages/Quotes';
import Precios from './pages/Precios'; // New: lista maestra de precios y tarifas
import Clients from './pages/Clients';
import TeamManagement from './pages/TeamManagement';
import UserManagement from './pages/UserManagement'; // New
import UserDashboard from './pages/UserDashboard'; // New
import Invoicing from './pages/Invoicing'; // New
import PaymentReceipts from './pages/PaymentReceipts'; // New
import Forge from './pages/Forge'; // New: motor paramétrico + AR
import ForgeARView from './pages/ForgeARView'; // New: visor AR público (QR)
import { User } from './types';
import { api } from './lib/api';
import { vinoDeRecuperacion } from './lib/supabaseClient';

export enum Page {
  Login,
  Dashboard,
  UserDashboard, // New
  Projects,
  Clients,
  Financials,
  ClientPortal,
  ProjectInit,
  ProjectDetails,
  Quotes,
  Precios, // New
  Team,
  UserManagement, // New
  Invoicing, // New
  PaymentReceipts, // New
  Forge // New
}

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>(Page.Login);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [initialProjectData, setInitialProjectData] = useState<any>(null);

  const [recuperando, setRecuperando] = useState(vinoDeRecuperacion);
  const arModelId = new URLSearchParams(window.location.search).get('ar');
  const [restaurando, setRestaurando] = useState(!arModelId && !vinoDeRecuperacion);

  // La sesión de Supabase Auth sobrevive al recargar: se retoma aquí. Antes
  // recargar la página te sacaba, porque el "login" sólo vivía en memoria.
  useEffect(() => {
    if (arModelId) return;
    if (!vinoDeRecuperacion) {
      api.auth.perfilActual()
        .then(u => { if (u) handleLogin(u); })
        .catch(e => console.warn('No se pudo retomar la sesión:', e))
        .finally(() => setRestaurando(false));
    }
    return api.auth.alCambiar(evento => {
      if (evento === 'recuperar') {
        setRecuperando(true);
        setCurrentPage(Page.Login);
      } else {
        setCurrentUser(null);
        setCurrentPage(Page.Login);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = (user: User) => {
    setRecuperando(false);
    setCurrentUser(user);
    if (user.role === 'Level 2') {
      setCurrentPage(Page.UserDashboard);
    } else {
      setCurrentPage(Page.Dashboard);
    }
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    if (!darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  const handleProjectSelect = (projectId: string) => {
    setSelectedProjectId(projectId);
    setCurrentPage(Page.ProjectDetails);
  };

  const handleAssignQuote = (quote: any) => {
    setInitialProjectData({
      name: quote.projectName,
      clientName: quote.clientName,
      budget: quote.totalAmount,
      projectOverview: quote.notes,
      // De dónde salió y CUÁNDO se cerró. Sin esto no hay forma de saber en
      // qué mes entró la venta: la fecha de la cotización es cuándo se ofertó
      // y la de inicio es cuándo arranca la obra, que pueden ser otros meses.
      quoteId: quote.id,
      soldAt: new Date().toISOString().slice(0, 10),
    });
    setCurrentPage(Page.ProjectInit);
  };

  const [initialQuoteId, setInitialQuoteId] = useState<string | null>(null);

  const handleNotificationClick = (notification: any) => {
    // 1. Approval Notification (Quotes)
    if (notification.type === 'approval') {
      // Extract ID from "quote-{id}"
      const quoteId = notification.id.replace('quote-', '');
      setInitialQuoteId(quoteId);
      setCurrentPage(Page.Quotes);
    }

    // 2. Deadline Notification (Projects)
    else if (notification.type === 'deadline') {
      const projectId = notification.id.replace('proj-', '');
      setSelectedProjectId(projectId);
      setCurrentPage(Page.ProjectDetails);
    }
  };

  // Visor AR público: /?ar=<forge_model_id> — sin login, es el link del QR
  if (arModelId) {
    return <ForgeARView modelId={arModelId} />;
  }

  if (restaurando) {
    return <div className="min-h-screen bg-[#F9F8F6]" aria-busy="true" />;
  }

  if (currentPage === Page.Login) {
    return <Login onLogin={handleLogin} recuperando={recuperando} />;
  }

  return (
    <div className={`flex h-screen overflow-hidden font-sans ${darkMode ? 'dark' : ''}`}>
      {/* Sidebar - Pass user to control links */}
      {(currentUser) && (
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} currentUser={currentUser} />
      )}

      <div className="flex-1 flex flex-col h-full bg-brand-bg dark:bg-gray-900 transition-colors duration-300">
        <Header
          role={currentUser ? (currentUser.role === 'Super User' ? 'admin' : 'client') : 'admin'} // Legacy mapping for Header
          darkMode={darkMode}
          toggleDarkMode={toggleDarkMode}
          onLogout={() => { api.auth.logout(); setCurrentUser(null); setCurrentPage(Page.Login); }}
          user={currentUser} // Pass full user if Header needs it
          onNotificationClick={handleNotificationClick}
        />

        {/* Va aquí, fuera del <main> y sin poder cerrarse: si el aviso vive
            dentro de una página, sólo se ve cuando ya entraste a facturar. */}
        <BannerFacturacion />

        <main className="flex-1 overflow-y-auto p-8 scrollbar-hide">
          {currentPage === Page.Dashboard && <Dashboard />}
          {currentPage === Page.UserDashboard && <UserDashboard />}
          {currentPage === Page.Projects && (
            <Projects
              onNewProject={() => {
                setInitialProjectData(null);
                setCurrentPage(Page.ProjectInit);
              }}
              onProjectSelect={handleProjectSelect}
              onAssignQuote={handleAssignQuote}
            />
          )}
          {currentPage === Page.Precios && <Precios />}
          {currentPage === Page.Financials && <Financials />}
          {currentPage === Page.ClientPortal && <ClientPortal />}
          {currentPage === Page.ProjectInit && (
            <ProjectInitialization
              onCancel={() => setCurrentPage(Page.Projects)}
              initialData={initialProjectData}
            />
          )}
          {currentPage === Page.ProjectDetails && selectedProjectId && (
            <ProjectDetails
              projectId={selectedProjectId}
              onBack={() => setCurrentPage(Page.Projects)}
              user={currentUser} // Pass user for permission checks
            />
          )}
          {currentPage === Page.Clients && <Clients />}

          {currentPage === Page.Quotes && <Quotes user={currentUser} />}
          {currentPage === Page.Team && <TeamManagement />}
          {currentPage === Page.UserManagement && <UserManagement />}
          {currentPage === Page.Invoicing && <Invoicing />}
          {currentPage === Page.PaymentReceipts && <PaymentReceipts />}
          {currentPage === Page.Forge && <Forge />}
        </main>
      </div>
    </div>
  );
};

export default App;