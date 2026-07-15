import { useState } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";

function Register() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [message, setMessage] = useState("");

  const handleRegister = async (e) => {
    e.preventDefault();

    try {
      const response = await axios.post("http://127.0.0.1:8000/register", {
        username,
        email,
        password,
      });

      setMessage(response.data.message);
    } catch (error) {
      setMessage("Register failed");
      console.error(error);
    }
  };

  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>Register</h1>

        <form onSubmit={handleRegister}>
          <div>
            <input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>

          <div style={{ marginTop: "10px" }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div style={{ marginTop: "10px" }}>
            <input
              type="password"
              placeholder="Password (6-72 characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              maxLength={72}
              required
            />
          </div>

          <button type="submit" style={{ marginTop: "15px" }}>
            Register
          </button>
        </form>

        {message && <p>{message}</p>}
      </div>
    </div>
  );
}

export default Register;