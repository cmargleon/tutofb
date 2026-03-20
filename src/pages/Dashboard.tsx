import React from 'react';

export const Dashboard: React.FC = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <p className="text-gray-600">Welcome to the Virtual Try-On internal tool.</p>
      </div>
    </div>
  );
};
