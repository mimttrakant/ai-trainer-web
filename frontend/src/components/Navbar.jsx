import { Link, useNavigate } from "react-router-dom";
import { api } from "../utils/api";

function Navbar() {
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("user"));

  const handleLogout = async () => {
    await api("/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("access_token");
    localStorage.removeItem("user");
    navigate("/");
    window.location.reload();
  };

  return (
    <nav
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "20px",
        borderBottom: "1px solid #ccc"
      }}
    >
      <Link to="/" style={{ textDecoration: "none", color: "white" }}>
        <h2>AI Trainer</h2>
      </Link>

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px", minWidth: 0, overflowWrap: "anywhere" }}>
        <Link to="/" style={{ marginRight: "10px" }}>
          Home
        </Link>

        {user ? (
          <>
            <Link to="/models" style={{ marginRight: "10px" }}>
              Models
            </Link>
            <Link to="/datasets" style={{ marginRight: "10px" }}>Datasets</Link>
            <Link to="/training" style={{ marginRight: "10px" }}>Training</Link>

            <span style={{ marginRight: "10px" }}>
              {user.username}
            </span>

            <button onClick={handleLogout}>
              Logout
            </button>
          </>
        ) : (
          <>
            <Link to="/login" style={{ marginRight: "10px" }}>
              Login
            </Link>

            <Link to="/register">
              Register
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
