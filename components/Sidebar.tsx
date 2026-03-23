import React, { useState } from 'react';
import { LayoutDashboard, FolderOpen, PieChart, Layers, Settings, FileText, Users, Shield, ChevronLeft, ChevronRight, Menu, Receipt } from 'lucide-react';
import { Page } from '../App';

import { User } from '../types';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  currentUser: User;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPage, onNavigate, currentUser }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const isSuperUser = currentUser.role === 'Super User';

  const navItems = [
    // Super User sees 'Dashboard', Level 2 sees 'UserDashboard' (Labelled "My Workspace")
    ...(isSuperUser ? [{ icon: LayoutDashboard, label: 'Dashboard', page: Page.Dashboard }] : []),
    ...(!isSuperUser ? [{ icon: LayoutDashboard, label: 'My Workspace', page: Page.UserDashboard }] : []),

    // Common items
    { icon: FolderOpen, label: 'Projects', page: Page.Projects },
    { icon: Users, label: 'Clients', page: Page.Clients },
    { icon: FileText, label: 'Quotes', page: Page.Quotes },
    { icon: FileText, label: 'Invoicing', page: Page.Invoicing },
    { icon: Receipt, label: 'REP / Pagos', page: Page.PaymentReceipts },

    // Super User Only
    ...(isSuperUser ? [
      { icon: Shield, label: 'Team', page: Page.Team },
      { icon: Users, label: 'Manage Users', page: Page.UserManagement }, // Reusing Users icon or Shield
      { icon: PieChart, label: 'Financials', page: Page.Financials }
    ] : [])
  ];

  return (
    <aside
      className={`${isCollapsed ? 'w-20' : 'w-64'} bg-primary text-white flex flex-col h-full shadow-xl transition-all duration-300 ease-in-out relative`}
    >
      {/* Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3 top-9 bg-white text-primary p-1 rounded-full shadow-lg hover:bg-gray-100 transition-colors z-50 border border-gray-100"
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      <div className={`p-8 border-b border-gray-800 flex items-center ${isCollapsed ? 'justify-center px-4' : ''}`}>
        {isCollapsed ? (
          <h1 className="font-serif text-xl italic font-bold">M</h1>
        ) : (
          <div>
            <h1 className="font-serif text-3xl italic tracking-wider whitespace-nowrap">MONO</h1>
            <p className="text-[10px] tracking-[0.4em] uppercase text-gray-400 mt-1 whitespace-nowrap">Atelier OS</p>
          </div>
        )}
      </div>

      <nav className="flex-1 py-8 px-4 space-y-2 overflow-x-hidden">
        {!isCollapsed && <p className="px-4 text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-4 transition-opacity duration-300">Collection</p>}
        {navItems.map((item) => (
          <button
            key={item.label}
            onClick={() => onNavigate(item.page)}
            className={`w-full flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-4 px-4'} py-3 text-sm tracking-widest uppercase transition-all duration-300 rounded ${currentPage === item.page
              ? 'bg-white text-primary font-bold shadow-md' // Removed pl-6 logic for cleaner collapsed state, handling it via flex center
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}
            title={isCollapsed ? item.label : ''}
          >
            <item.icon size={18} className="shrink-0" />
            <span className={`transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'}`}>
              {item.label}
            </span>
          </button>
        ))}
      </nav>

      <div className={`p-8 border-t border-gray-800 ${isCollapsed ? 'flex justify-center' : ''}`}>
        <button
          className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-3'} text-gray-400 hover:text-white transition-colors text-xs uppercase tracking-widest w-full`}
          title="System Config"
        >
          <Settings size={16} />
          <span className={`transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-auto opacity-100'}`}>
            System Config
          </span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
