import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

function Dashboard() {
  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px", textAlign: "center" }}>
        <h1>AI Trainer</h1>
        <p>Build and train your AI model visually.</p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "20px",
            marginTop: "30px",
          }}
        >
          <div style={cardStyle}>
            <h2>Dataset</h2>
            <p>Upload and manage training data.</p>
            <Link to="/projects">
              <button>Open Dataset</button>
            </Link>
          </div>

          <div style={cardStyle}>
            <h2>Project</h2>
            <p>Create and manage your AI projects.</p>
            <Link to="/projects">
              <button>Open Project</button>
            </Link>
          </div>

          <div style={cardStyle}>
            <h2>Training</h2>
            <p>Train model and monitor loss / accuracy.</p>
            <Link to="/projects">
              <button>Open Training</button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const cardStyle = {
  border: "1px solid #ccc",
  padding: "30px",
  borderRadius: "10px",
};

export default Dashboard;