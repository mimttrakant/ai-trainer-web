import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
import Navbar from "../components/Navbar";

function ProjectDetail() {
  const { id } = useParams();

  const [project, setProject] = useState(null);

  useEffect(() => {
    fetchProject();
  }, []);

  const fetchProject = async () => {
    try {
      const response = await axios.get(
        `http://127.0.0.1:8000/project/${id}`
      );

      setProject(response.data.project);
    } catch (error) {
      console.error(error);
    }
  };

  if (!project) {
    return (
      <div>
        <Navbar />
        <h2 style={{ padding: "40px" }}>
          Loading...
        </h2>
      </div>
    );
  }

  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px" }}>
        <Link to="/projects">
          ← Back to Projects
        </Link>

        <h1>{project.name}</h1>

        <p>
          <strong>Status:</strong>{" "}
          {project.status}
        </p>

        <p>
          <strong>Description:</strong>
        </p>

        <p>{project.description}</p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(3, 1fr)",
            gap: "20px",
            marginTop: "30px",
          }}
        >
          <div style={cardStyle}>
            <h2>Dataset</h2>

            <p>
              Upload and manage
              training data.
            </p>

            <Link to={`/projects/${id}/dataset`}>
              <button>Open Dataset</button>
            </Link>
          </div>

          <div style={cardStyle}>
            <h2>Model Builder</h2>

            <p>
              Drag and drop layers
              to build your model.
            </p>

            <Link to={`/projects/${id}/builder`}>
                <button>Open Builder</button>
            </Link>
          </div>

          <div style={cardStyle}>
            <h2>Training</h2>

            <p>
              Train model and monitor
              loss / accuracy.
            </p>

            <Link to={`/projects/${id}/training`}>
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
  padding: "20px",
  borderRadius: "10px",
};

export default ProjectDetail;