import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import App from './App';
import { WorkspacePage } from './WorkspacePage';
import { routeManifest } from './routes';
import { WorkspaceErrorBoundary } from './WorkspaceErrorBoundary';
import { applyMotionTokens } from './routeMotion';
import { AcceptInvitation, captureAccountActionLink, ForgotPassword, ResetPassword } from './AccountActionScreen';
import './styles.css';

applyMotionTokens(document.documentElement);
captureAccountActionLink();

const router = createBrowserRouter([
  { path: '/account/forgot-password', Component: ForgotPassword, ErrorBoundary: WorkspaceErrorBoundary },
  { path: '/account/reset-password', Component: ResetPassword, ErrorBoundary: WorkspaceErrorBoundary },
  { path: '/account/activate', Component: AcceptInvitation, ErrorBoundary: WorkspaceErrorBoundary },
  { Component: App, ErrorBoundary: WorkspaceErrorBoundary, children: [
    { index: true, Component: WorkspacePage, ErrorBoundary: WorkspaceErrorBoundary },
    { path: '/login', Component: WorkspacePage, ErrorBoundary: WorkspaceErrorBoundary },
    ...routeManifest.map(route => ({ path: route.path, Component: WorkspacePage, ErrorBoundary: WorkspaceErrorBoundary })),
    { path: '/forbidden', Component: WorkspacePage, ErrorBoundary: WorkspaceErrorBoundary },
    { path: '*', Component: WorkspacePage, ErrorBoundary: WorkspaceErrorBoundary },
  ] },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
