// Sign-in is delegated to Microsoft (Entra ID). This page just shows a button
// that sends the browser to the server's OAuth start route; on success the
// server redirects back with an app token that api.js captures.

const MsLogo = () => (
  <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

export default function LoginPage() {
  const error = new URLSearchParams(window.location.search).get('auth_error');
  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          Cloud<span>Fuze</span> Marketing
        </div>
        <div className="login-sub">Sign in to the marketing dashboard</div>

        {error && <div className="login-error">{error}</div>}

        <a className="btn login-btn ms-btn" href="/api/auth/login">
          <MsLogo />
          Sign in with Microsoft
        </a>
      </div>
    </div>
  );
}
