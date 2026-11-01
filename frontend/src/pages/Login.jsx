import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Navbar from "../components/Navbar";

function Login() {
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setMessage("");

    try {
      const response = await axios.post("http://127.0.0.1:8000/login", {
        identifier,
        password,
      });

      setMessage(response.data.message);

      if (response.data.success) {
        localStorage.setItem("access_token", response.data.access_token);
        localStorage.setItem("user", JSON.stringify(response.data.user));
        navigate("/");
      }
    } catch (error) {
      setMessage("Login failed");
      console.error(error);
    }
  };

  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Login</h1>

        <form onSubmit={handleLogin}>
          <div>
            <input
              type="text"
              placeholder="Username or Email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </div>

          <div style={{ marginTop: "10px" }}>
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={72}
              required
            />
          </div>

          <button type="submit" style={{ marginTop: "15px" }}>
            Login
          </button>
        </form>

        {message && <p>{message}</p>}
      </div>
    </div>
  );
}

export default Login;
