import { useEffect, useState } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import { Link } from "react-router-dom";

function Projects() {
  const user = JSON.parse(localStorage.getItem("user"));

  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const fetchProjects = async () => {
    if (!user) return;

    const response = await axios.get(
      `http://127.0.0.1:8000/projects/${user.id}`
    );

    setProjects(response.data.projects);
  };

  const createProject = async (e) => {
    e.preventDefault();

    if (!user) {
      alert("Please login first");
      return;
    }

    await axios.post("http://127.0.0.1:8000/projects", {
      name,
      description,
      owner_id: user.id,
    });

    setName("");
    setDescription("");

    fetchProjects();
  };

  useEffect(() => {
    fetchProjects();
  }, []);
  const deleteProject = async (projectId) => {
  const confirmDelete = window.confirm(
    "Are you sure you want to delete this project?"
  );

  if (!confirmDelete) return;

  await axios.delete(
    `http://127.0.0.1:8000/projects/${projectId}`
  );

  fetchProjects();
};

  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px" }}>
        <h1>Projects</h1>

        {!user && <p>Please login to view your projects.</p>}

        {user && (
          <>
            <form onSubmit={createProject}>
              <h2>Create New Project</h2>

              <div>
                <input
                  type="text"
                  placeholder="Project name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div style={{ marginTop: "10px" }}>
                <textarea
                  placeholder="Project description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <button type="submit" style={{ marginTop: "10px" }}>
                Create Project
              </button>
            </form>

            <hr />

            <h2>My Projects</h2>

            {projects.length === 0 && <p>No projects yet.</p>}

            {projects.map((project) => (
                <div
                    key={project.id}
                    style={{
                    border: "1px solid #ccc",
                    padding: "15px",
                    marginBottom: "10px",
                    borderRadius: "8px",
                    }}
                >
                    <h3>{project.name}</h3>

                    <p>{project.description}</p>

                    <p>Status: {project.status}</p>

                    {/* ปุ่ม Open */}
                    <Link to={`/projects/${project.id}/builder`}>
                      <button>Open</button>
                    </Link>

                    {/* ปุ่ม Delete */}
                    <button
                    onClick={() => deleteProject(project.id)}
                    style={{
                        marginLeft: "10px",
                        backgroundColor: "red",
                        color: "white",
                    }}
                    >
                    Delete
                    </button>
                </div>
                ))}
          </>
        )}
      </div>
    </div>
  );
}

export default Projects;