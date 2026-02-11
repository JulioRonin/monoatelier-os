import React, { useState, useEffect } from 'react';
import { Bell, Search, Moon, Sun, LogOut, AlertTriangle, CheckCircle, DollarSign, Clock } from 'lucide-react';
import { User } from '../types';
import { api } from '../lib/api';

interface HeaderProps {
  role: 'admin' | 'client'; // Legacy
  darkMode: boolean;
  toggleDarkMode: () => void;
  onLogout: () => void;
  user: User | null;
  onNotificationClick?: (notification: Notification) => void;
}

export interface Notification {
  id: string;
  type: 'approval' | 'deadline' | 'payment';
  title: string;
  subtitle: string;
  time: string;
  data?: any;
}

const Header: React.FC<HeaderProps> = ({ role, darkMode, toggleDarkMode, onLogout, user, onNotificationClick }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    loadNotifications();
  }, [user]);

  const loadNotifications = async () => {
    if (!user) return;
    const newNotes: Notification[] = [];

    try {
      // 1. Check for Pending Approvals (Super User Only)
      if (user.role === 'Super User') {
        const quotes = await api.getQuotes();
        const pending = quotes.filter((q: any) => q.status === 'Awaiting Approval'); // Assuming status logic exists or will map
        // Or quotes > 25k not approved
        const highValue = quotes.filter((q: any) => q.totalAmount > 25000 && q.status !== 'Approved' && q.status !== 'Rejected');

        highValue.forEach((q: any) => {
          newNotes.push({
            id: `quote-${q.id}`,
            type: 'approval',
            title: 'Approval Required',
            subtitle: `Quote for ${q.clientName} ($${q.totalAmount.toLocaleString()})`,
            time: 'Action Needed'
          });
        });
      }

      // 2. Deadline approaching (All Users)
      const projects = await api.getProjects();
      const now = new Date();
      const sevenDays = new Date();
      sevenDays.setDate(now.getDate() + 7);

      projects.forEach((p: any) => {
        if (p.dueDate && p.status === 'In Progress') {
          const due = new Date(p.dueDate);
          if (due <= sevenDays && due >= now) {
            newNotes.push({
              id: `proj-${p.id}`,
              type: 'deadline',
              title: 'Project Due Soon',
              subtitle: `${p.name} due on ${p.dueDate}`,
              time: 'Upcoming'
            });
          }
        }
      });

      // 3. Recent Payments (Mock or Real)
      const payments = await api.getAllPayments(); // Assuming this exists or using getProjects loop
      // Just mock one for demo if no real recent payment logic
      // newNotes.push({ id: 'pay-1', type: 'payment', title: 'Payment Received', subtitle: '$5,000 from Client X', time: '2h ago' });

      setNotifications(newNotes);
    } catch (e) {
      console.error("Error loading notifications", e);
    }
  };

  return (
    <header className="h-20 bg-surface dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between px-8 transition-colors duration-300 relative z-40">
      <div className="flex items-center gap-4">
        {role === 'admin' && (
          <div className="relative group">
            <Search className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search projects, clients..."
              className="bg-transparent border-b border-gray-300 dark:border-gray-700 pl-8 pr-4 py-2 text-sm focus:outline-none focus:border-primary dark:focus:border-white w-64 transition-all dark:text-gray-200"
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        <button onClick={toggleDarkMode} className="text-gray-400 hover:text-primary dark:hover:text-white transition-colors">
          {darkMode ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        {/* Notifications */}
        <div className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="relative text-gray-400 hover:text-primary dark:hover:text-white transition-colors"
          >
            <Bell size={20} />
            {notifications.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-secondary rounded-full border-2 border-white dark:border-gray-900"></span>
            )}
          </button>

          {showDropdown && (
            <div className="absolute right-0 top-full mt-4 w-96 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-fade-in-up z-50">
              <div className="p-4 border-b border-gray-50 dark:border-gray-700 font-bold dark:text-white flex justify-between items-center bg-gray-50/50 dark:bg-gray-800">
                <span>Notifications</span>
                <span className="text-[10px] bg-primary/10 text-primary dark:text-secondary px-2 py-1 rounded-full">{notifications.length} New</span>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-xs">No new notifications</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} className="p-4 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors group">
                      <div className="flex gap-4 items-start">
                        <div className={`mt-1 p-2 rounded-full h-fit shrink-0 ${n.type === 'approval' ? 'bg-orange-50 text-orange-500 ring-1 ring-orange-100' :
                          n.type === 'deadline' ? 'bg-red-50 text-red-500 ring-1 ring-red-100' :
                            'bg-green-50 text-green-500 ring-1 ring-green-100'
                          }`}>
                          {n.type === 'approval' ? <AlertTriangle size={16} /> :
                            n.type === 'deadline' ? <Clock size={16} /> :
                              <DollarSign size={16} />}
                        </div>
                        <div className="flex-1">
                          <div className="flex justify-between items-start mb-1">
                            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-200 leading-tight">{n.title}</h4>
                            <span className="text-[10px] text-gray-400 uppercase tracking-widest whitespace-nowrap ml-2">{n.time}</span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">{n.subtitle}</p>

                          {/* Action Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onNotificationClick) {
                                onNotificationClick(n);
                                setShowDropdown(false);
                              }
                            }}
                            className="text-[10px] uppercase font-bold tracking-widest text-primary dark:text-secondary hover:underline flex items-center gap-1 group-hover:translate-x-1 transition-transform"
                          >
                            View Details <CheckCircle size={10} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="p-3 bg-gray-50 dark:bg-gray-800/80 border-t border-gray-100 dark:border-gray-700 text-center">
                <button onClick={() => setNotifications([])} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors uppercase tracking-widest">Mark all as read</button>
              </div>
            </div>
          )}
        </div>

        <div className="h-8 w-[1px] bg-gray-300 dark:bg-gray-700"></div>

        {/* User Profile */}
        <div className="flex items-center gap-4">
          <img
            src={user?.avatarUrl || "https://ui-avatars.com/api/?name=" + (user?.fullName || "User") + "&background=random"}
            alt="User"
            className="w-10 h-10 rounded-full border-2 border-white shadow-sm object-cover"
          />
          <div className="hidden md:block text-right leading-tight">
            <p className="text-sm font-bold uppercase tracking-wider text-primary dark:text-white">
              {user?.fullName || 'Guest User'}
            </p>
            <p className="text-[10px] text-gray-400 font-mono uppercase tracking-widest">
              {user?.role === 'Super User' ? 'Controller' : 'Team Member'}
            </p>
          </div>
          <button onClick={onLogout} className="ml-2 text-gray-400 hover:text-danger conversion-colors" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
