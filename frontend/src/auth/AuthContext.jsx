import { createContext, useContext, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

const ROLE_HOME = {
  super_admin: '/admin/dashboard',
  school_admin: '/admin/dashboard',
  principal: '/principal/dashboard',
  chairperson: '/chairperson/dashboard',
  parent: '/parent/view',
  class_teacher: '/teacher/attendance',
  admin: '/admin/dashboard', // legacy fallback
};

export function homePathFor(role) {
  return ROLE_HOME[role] || '/teacher/attendance';
}

export function isAdmin(role) {
  return role === 'super_admin' || role === 'school_admin' || role === 'admin';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem('user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      // Corrupted / legacy value must never white-screen the whole app.
      try { localStorage.removeItem('user'); } catch { /* ignore */ }
      return null;
    }
  });
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('token'); } catch { return null; }
  });

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    const { access_token, role, full_name, school_id, assigned_class_id } = res.data;
    const userData = { email, role, full_name, school_id, assigned_class_id };
    try {
      localStorage.setItem('token', access_token);
      localStorage.setItem('user', JSON.stringify(userData));
    } catch { /* storage full/unavailable — session works in-memory */ }
    setToken(access_token);
    setUser(userData);
    return userData;
  };

  const logout = () => {
    try {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    } catch { /* ignore */ }
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
