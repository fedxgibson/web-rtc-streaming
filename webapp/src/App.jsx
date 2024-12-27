import React, { Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';

// Layouts
const MainLayout = React.lazy(() => import('./layouts/MainLayout'));
const Dashboard = React.lazy(() => import('./pages/Dashboard'));
const NotFound = React.lazy(() => import('./pages/NotFound'));

const LoadingFallback = () => (
  <div data-test-id="loading-fallback" className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
  </div>
);

function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        {/* Protected routes */}
        <Route
          path="/"
          element={<MainLayout />}
        >
          <Route index element={<Dashboard />} />
        </Route>

        {/* 404 route */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;
