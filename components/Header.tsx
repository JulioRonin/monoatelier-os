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
}

interface Notification {
  id: string;
  type: 'approval' | 'deadline' | 'payment';
  title: string;
  subtitle: string;
  time: string;
}

const Header: React.FC<HeaderProps> = ({ role, darkMode, toggleDarkMode, onLogout, user }) => {
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
            <div className="absolute right-0 top-full mt-4 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden animate-fade-in-up">
              <div className="p-4 border-b border-gray-50 dark:border-gray-700 font-bold dark:text-white flex justify-between">
                <span>Notifications</span>
                <span className="text-[10px] bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-full">{notifications.length} New</span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-xs">No new notifications</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} className="p-4 border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer flex gap-3">
                      <div className={`mt-1 p-2 rounded-full h-fit shrink-0 ${n.type === 'approval' ? 'bg-orange-50 text-orange-500' :
                          n.type === 'deadline' ? 'bg-red-50 text-red-500' :
                            'bg-green-50 text-green-500'
                        }`}>
                        {n.type === 'approval' ? <AlertTriangle size={14} /> :
                          n.type === 'deadline' ? <Clock size={14} /> :
                            <DollarSign size={14} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-800 dark:text-gray-200">{n.title}</p>
                        <p className="text-xs text-gray-500 mb-1">{n.subtitle}</p>
                        <p className="text-[10px] text-gray-400 uppercase tracking-widest">{n.time}</p>
                      </div>
                    </div>
                  ))
                )}
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
