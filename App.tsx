import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import Financials from './pages/Financials';
import ClientPortal from './pages/ClientPortal';
import ProjectInitialization from './pages/ProjectInitialization';
import ProjectDetails from './pages/ProjectDetails';
import Quotes from './pages/Quotes';
import Clients from './pages/Clients';
import TeamManagement from './pages/TeamManagement';
import UserManagement from './pages/UserManagement'; // New
import UserDashboard from './pages/UserDashboard'; // New
import Invoicing from './pages/Invoicing'; // New
import PaymentReceipts from './pages/PaymentReceipts'; // New
import { User } from './types';

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
  Team,
  UserManagement, // New
  Invoicing, // New
  PaymentReceipts // New
}

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>(Page.Login);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [initialProjectData, setInitialProjectData] = useState<any>(null);

  const handleLogin = (user: User) => {
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
      projectOverview: quote.notes
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

  if (currentPage === Page.Login) {
    return <Login onLogin={handleLogin} />;
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
          onLogout={() => { setCurrentUser(null); setCurrentPage(Page.Login); }}
          user={currentUser} // Pass full user if Header needs it
          onNotificationClick={handleNotificationClick}
        />

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
        </main>
      </div>
    </div>
  );
};

export default App;