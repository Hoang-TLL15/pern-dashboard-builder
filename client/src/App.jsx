import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './App.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Register from './pages/Register';
import DbConnectionList from './pages/DbConnectionList';
import DbConnectionDetail from './pages/DbConnectionDetail';
import ReportList from './pages/ReportList';
import ReportEditor from './pages/ReportEditor';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route
        path="/reports"
        element={
          <ProtectedRoute>
            <ReportList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/new"
        element={
          <ProtectedRoute>
            <ReportEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/reports/:id"
        element={
          <ProtectedRoute>
            <ReportEditor />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-sources"
        element={
          <ProtectedRoute>
            <DbConnectionList />
          </ProtectedRoute>
        }
      />
      <Route
        path="/data-sources/:id"
        element={
          <ProtectedRoute>
            <DbConnectionDetail />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/reports" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
