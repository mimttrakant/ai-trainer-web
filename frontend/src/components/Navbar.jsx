import { Link, useLocation, useNavigate } from "react-router-dom";
import { api, getUser } from "../utils/api";
import "./Navbar.css";

function Navbar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const user = getUser();
  // Keep the old project URLs visually consistent with the renamed sections.
  const section = pathname.endsWith("/training") ? "/training"
    : pathname.endsWith("/dataset") ? "/datasets"
      : pathname.startsWith("/projects") ? "/models"
        : `/${pathname.split("/")[1]}`;
  const links = user
    ? [["/", "Home"], ["/models", "Models"], ["/datasets", "Datasets"], ["/training", "Training"]]
    : [["/", "Home"], ["/login", "Login"], ["/register", "Register"]];

  const handleLogout = async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    navigate("/");
    window.location.reload();
  };

  return (
    <nav className="app-navbar" aria-label="Main navigation">
      <Link to="/" className="app-navbar__brand">AI Trainer</Link>
      <div className="app-navbar__links">
        {links.map(([to, label]) => <Link key={to} to={to} className="app-navbar__link"
          aria-current={section === to ? "page" : undefined}>{label}</Link>)}
      </div>
      {user && <div className="app-navbar__account">
        <span className="app-navbar__username" title={user.username}>{user.username}</span>
        <button type="button" className="app-navbar__logout" onClick={handleLogout}>Logout</button>
      </div>}
    </nav>
  );
}

export default Navbar;
