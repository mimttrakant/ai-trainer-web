import { Link, useNavigate } from "react-router-dom";

function Navbar() {
  const navigate = useNavigate();

  const user = JSON.parse(localStorage.getItem("user"));

  const handleLogout = () => {
    localStorage.removeItem("user");
    navigate("/");
    window.location.reload();
  };

  return (
    <nav
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "20px",
        borderBottom: "1px solid #ccc"
      }}
    >
      <Link to="/" style={{ textDecoration: "none", color: "white" }}>
        <h2>AI Trainer</h2>
      </Link>

      <div>
        <Link to="/" style={{ marginRight: "10px" }}>
          Home
        </Link>

        {user ? (
          <>
            <Link to="/projects" style={{ marginRight: "10px" }}>
              Projects
            </Link>

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