// Lớp state (tương đương "controller" bên FE) — quản lý state React,
// gọi xuống authService, không tự gọi API hay đụng localStorage trực tiếp.
import { createContext, useContext, useState } from 'react';
import authService from '../services/authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(authService.getStoredUser());

  async function login(username, password) {
    const loggedInUser = await authService.login(username, password);
    setUser(loggedInUser);
  }

  async function register(username, password) {
    await authService.register(username, password);
  }

  function logout() {
    authService.logout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
