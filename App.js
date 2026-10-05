import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Platform } from 'react-native';
import { AuthContext } from './src/core/context/AuthContext';
import { setAuthToken, loadStoredToken, setStoreData } from './src/core/services/api';
import AppNavigator from './src/core/navigation/AppNavigator';

// Inject Inter font stack globally for web
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
    body, input, button, select, textarea {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    html, body, #root {
      max-width: 100vw;
      overflow-x: hidden;
    }
  `;
  document.head.appendChild(style);
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // On mount, check for a stored token
  useEffect(() => {
    (async () => {
      try {
        const token = await loadStoredToken();
        if (token) {
          setIsAuthenticated(true);
        }
      } catch (e) {
        console.warn('Failed to load stored token:', e);
      } finally {
        setIsLoading(false);
        //this is the test page
      }
    })();
  }, []);

  const signIn = useCallback(async (token, storeId) => {
    await setAuthToken(token);
    if (storeId) {
      await setStoreData(storeId);
    }
    setIsAuthenticated(true);
  }, []);

  const signOut = useCallback(async () => {
    await setAuthToken(null);
    await setStoreData(null);
    setIsAuthenticated(false);
  }, []);

  const authContext = useMemo(() => ({
    isAuthenticated,
    isLoading,
    signIn,
    signOut,
  }), [isAuthenticated, isLoading, signIn, signOut]);

  return (
    <AuthContext.Provider value={authContext}>
      <AppNavigator />
    </AuthContext.Provider>
  );
}
