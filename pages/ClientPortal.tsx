import React from 'react';
import { MOCK_PROJECTS } from '../constants';

const ClientPortal: React.FC = () => {
  // Mock logged in client viewing their project
  const project = MOCK_PROJECTS[0]; 

  return (
    <div className="space-y-12 animate-fade-in max-w-5xl mx-auto">
      <div className="text-center pt-8 pb-12">
        <p className="text-[10px] uppercase tracking-[0.4em] text-gray-400 mb-4">Project Portal</p>
        <h1 className="font-serif text-5xl md:text-7xl dark:text-white mb-6 leading-tight">
            {project.name}
        </h1>
        <p className="text-sm font-light text-gray-500 dark:text-gray-400 max-w-lg mx-auto leading-relaxed">
            {project.projectOverview}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-8">
            {/* Progress Gallery */}
            <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                <div className="flex justify-between items-end mb-8">
                    <h3 className="font-serif text-2xl italic dark:text-white">Progress Gallery</h3>
                    <button className="text-[10px] uppercase tracking-widest hover:text-secondary dark:text-gray-300 transition-colors">View All</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="aspect-video bg-gray-100 overflow-hidden relative group">
                        <img src="https://images.unsplash.com/photo-1531835551805-16d864c8d311?auto=format&fit=crop&q=80" alt="Construction 1" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    </div>
                     <div className="aspect-video bg-gray-100 overflow-hidden relative group">
                        <img src="https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&q=80" alt="Construction 2" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    </div>
                </div>
            </div>

            {/* Daily Log Notes */}
             <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                <h3 className="font-serif text-2xl italic dark:text-white mb-6">Latest Updates</h3>
                <div className="space-y-6">
                    <div className="pl-6 border-l border-secondary relative">
                        <div className="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-secondary rounded-full"></div>
                        <p className="text-xs font-mono text-gray-400 mb-1">TODAY, 10:00 AM</p>
                        <h4 className="font-bold text-sm text-primary dark:text-white mb-2">Countertop Installation</h4>
                        <p className="text-sm text-gray-500 font-light">The Calacata Grey marble arrived on site. Installation team has begun leveling the base cabinets.</p>
                    </div>
                    <div className="pl-6 border-l border-gray-200 dark:border-gray-600 relative opacity-60">
                         <div className="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-gray-300 rounded-full"></div>
                        <p className="text-xs font-mono text-gray-400 mb-1">YESTERDAY</p>
                        <h4 className="font-bold text-sm text-primary dark:text-white mb-2">Electrical Inspection Passed</h4>
                        <p className="text-sm text-gray-500 font-light">All rough-ins approved by city inspector.</p>
                    </div>
                </div>
            </div>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-8">
            <div className="bg-primary text-white p-8">
                <p className="text-[10px] uppercase tracking-widest opacity-60 mb-2">Outstanding Balance</p>
                <h3 className="font-serif text-4xl mb-6">$12,450.00</h3>
                <button className="w-full py-4 bg-white text-primary text-xs font-bold uppercase tracking-widest hover:bg-secondary transition-colors">
                    Pay via Stripe
                </button>
                <div className="mt-4 flex items-center gap-2 justify-center opacity-60">
                    <span className="material-icons text-xs">lock</span>
                    <span className="text-[10px] uppercase tracking-widest">Secured Transaction</span>
                </div>
            </div>

            <div className="bg-white dark:bg-gray-800 p-8 border border-gray-100 dark:border-gray-700">
                 <h3 className="font-serif text-xl italic dark:text-white mb-6">Documents</h3>
                 <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 transition-colors cursor-pointer">
                        <span className="material-icons text-gray-400">picture_as_pdf</span>
                        <div className="flex-1">
                            <p className="text-xs font-bold text-primary dark:text-white">Contract_Signed.pdf</p>
                            <p className="text-[10px] text-gray-400">2.4 MB</p>
                        </div>
                    </div>
                     <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 transition-colors cursor-pointer">
                        <span className="material-icons text-gray-400">image</span>
                        <div className="flex-1">
                            <p className="text-xs font-bold text-primary dark:text-white">Render_Final_v2.jpg</p>
                            <p className="text-[10px] text-gray-400">4.1 MB</p>
                        </div>
                    </div>
                 </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ClientPortal;
