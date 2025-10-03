/**
 * Shared Authentication Module
 *
 * Provides authentication utilities for all agent pages
 * - JWT verification via cookie
 * - User session management
 * - Protected page navigation
 * - User info display
 */

class AuthManager {
  constructor() {
    this.user = null;
    this.authenticated = false;
    this.API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3001' : '';
  }

  /**
   * Initialize auth - check if user is authenticated
   * Call this on page load
   *
   * @returns {Promise<Object|null>} User object if authenticated, null otherwise
   */
  async init() {
    try {
      const response = await fetch(`${this.API_BASE}/api/verify-auth`, {
        credentials: 'include' // Send cookies
      });

      const data = await response.json();

      if (data.authenticated && data.user) {
        this.user = data.user;
        this.authenticated = true;
        console.log('✅ User authenticated:', this.user.email);
        return this.user;
      } else {
        this.user = null;
        this.authenticated = false;
        console.log('❌ User not authenticated');
        return null;
      }

    } catch (error) {
      console.error('Auth initialization error:', error);
      this.user = null;
      this.authenticated = false;
      return null;
    }
  }

  /**
   * Verify authentication status
   *
   * @returns {Promise<boolean>} True if authenticated
   */
  async verifyAuth() {
    const user = await this.init();
    return user !== null;
  }

  /**
   * Get current user
   *
   * @returns {Object|null} User object or null
   */
  getUser() {
    return this.user;
  }

  /**
   * Check if user is authenticated
   *
   * @returns {boolean} True if authenticated
   */
  isAuthenticated() {
    return this.authenticated;
  }

  /**
   * Logout user
   * Clears session and redirects to login
   */
  async logout() {
    try {
      // Call logout API to clear cookie
      await fetch(`${this.API_BASE}/api/logout`, {
        method: 'POST',
        credentials: 'include'
      });

      // Clear local state
      this.user = null;
      this.authenticated = false;

      // Redirect to login
      window.location.href = '/login.html';

    } catch (error) {
      console.error('Logout error:', error);
      // Force redirect anyway
      window.location.href = '/login.html';
    }
  }

  /**
   * Require authentication for current page
   * Redirects to login if not authenticated
   *
   * @param {string} redirectTo - URL to redirect to after login (optional)
   */
  async requireAuth(redirectTo = null) {
    const isAuth = await this.verifyAuth();

    if (!isAuth) {
      const redirect = redirectTo || window.location.pathname;
      window.location.href = `/login.html?redirect=${encodeURIComponent(redirect)}`;
    }
  }

  /**
   * Display user info in specified element
   *
   * @param {string} elementId - ID of element to inject user UI
   */
  displayUserInfo(elementId) {
    if (!this.user) {
      console.warn('No user to display');
      return;
    }

    const element = document.getElementById(elementId);
    if (!element) {
      console.warn(`Element ${elementId} not found`);
      return;
    }

    element.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        ${this.user.picture ? `<img src="${this.user.picture}" alt="${this.user.name}" style="width: 32px; height: 32px; border-radius: 50%;">` : ''}
        <div style="display: flex; flex-direction: column;">
          <span style="font-weight: 500; font-size: 0.9rem;">${this.user.name}</span>
          <span style="font-size: 0.75rem; color: #6b7280;">${this.user.email}</span>
        </div>
        <button onclick="authManager.logout()" style="margin-left: 0.5rem; padding: 0.375rem 0.75rem; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.875rem;">
          Logout
        </button>
      </div>
    `;
  }

  /**
   * Protect page - wrapper for requireAuth
   * Call this immediately on page load
   */
  async protectPage() {
    await this.requireAuth();
  }
}

// Create global auth manager instance
const authManager = new AuthManager();
