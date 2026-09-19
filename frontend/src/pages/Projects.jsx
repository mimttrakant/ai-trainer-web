import { useEffect, useState } from "react";
import axios from "axios";
import Navbar from "../components/Navbar";
import { Link } from "react-router-dom";

const API_URL = "http://127.0.0.1:8000";

function Projects() {
  const user = JSON.parse(localStorage.getItem("user") || "null");

  const [projects, setProjects] = useState([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const fetchProjects = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const response = await axios.get(
        `${API_URL}/projects/${user.id}`
      );
      setProjects(response.data.projects || []);
    } catch (error) {
      console.error("Fetch projects error:", error);
      setMessage("Unable to load projects.");
    } finally {
      setLoading(false);
    }
  };

  const createProject = async (event) => {
    event.preventDefault();

    if (!user) {
      setMessage("Please login first.");
      return;
    }

    if (!name.trim()) {
      setMessage("Please enter a project name.");
      return;
    }

    setCreating(true);
    setMessage("");

    try {
      const response = await axios.post(`${API_URL}/projects`, {
        name: name.trim(),
        description: description.trim(),
        owner_id: user.id,
      });

      if (!response.data.success) {
        setMessage(response.data.message || "Unable to create project.");
        return;
      }

      setName("");
      setDescription("");
      setMessage("Project created successfully.");
      await fetchProjects();
    } catch (error) {
      console.error("Create project error:", error);
      setMessage("Unable to create project.");
    } finally {
      setCreating(false);
    }
  };

  const deleteProject = async (projectId) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this project?"
    );

    if (!confirmDelete) return;

    try {
      await axios.delete(`${API_URL}/projects/${projectId}`);
      await fetchProjects();
    } catch (error) {
      console.error("Delete project error:", error);
      setMessage("Unable to delete project.");
    }
  };

  useEffect(() => {
    fetchProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={styles.page}>
      <Navbar />

      <main style={styles.main}>
        <section style={styles.hero}>
          <div>
            <p style={styles.eyebrow}>PROJECT WORKSPACE</p>
            <h1 style={styles.title}>Projects</h1>
            <p style={styles.subtitle}>
              Create a project, design its architecture, then choose exactly
              which project you want to train.
            </p>
          </div>

          <div style={styles.heroBadge}>
            {projects.length} {projects.length === 1 ? "PROJECT" : "PROJECTS"}
          </div>
        </section>

        {message && <div style={styles.message}>{message}</div>}

        {!user && (
          <section style={styles.panel}>
            <div style={styles.emptyState}>
              <h2 style={styles.emptyTitle}>Login required</h2>
              <p style={styles.emptyText}>
                Please login before creating or managing projects.
              </p>

              <Link to="/login" style={styles.linkReset}>
                <button type="button" style={styles.primaryButton}>
                  Go to Login
                </button>
              </Link>
            </div>
          </section>
        )}

        {user && (
          <>
            <section style={styles.panel}>
              <div style={styles.sectionHeader}>
                <div>
                  <p style={styles.sectionNumber}>01</p>
                  <h2 style={styles.sectionTitle}>Create New Project</h2>
                  <p style={styles.sectionDescription}>
                    Start a workspace for a new model architecture.
                  </p>
                </div>
              </div>

              <form onSubmit={createProject} style={styles.createForm}>
                <label style={styles.field}>
                  <span style={styles.label}>Project Name</span>
                  <input
                    type="text"
                    placeholder="e.g. Exercise Classifier"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    style={styles.input}
                  />
                </label>

                <label style={styles.field}>
                  <span style={styles.label}>Description</span>
                  <textarea
                    placeholder="What will this project be used for?"
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    style={styles.textarea}
                  />
                </label>

                <button
                  type="submit"
                  disabled={creating}
                  style={{
                    ...styles.primaryButton,
                    opacity: creating ? 0.6 : 1,
                  }}
                >
                  {creating ? "Creating..." : "+ Create Project"}
                </button>
              </form>
            </section>

            <section style={styles.projectsSection}>
              <div style={styles.sectionHeader}>
                <div>
                  <p style={styles.sectionNumber}>02</p>
                  <h2 style={styles.sectionTitle}>My Projects</h2>
                  <p style={styles.sectionDescription}>
                    Open a project, edit its model architecture, or send it
                    directly to training.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={fetchProjects}
                  style={styles.secondaryButton}
                >
                  Refresh
                </button>
              </div>

              {loading ? (
                <div style={styles.emptyState}>Loading projects...</div>
              ) : projects.length === 0 ? (
                <div style={styles.emptyState}>
                  <h3 style={styles.emptyTitle}>No projects yet</h3>
                  <p style={styles.emptyText}>
                    Create your first project above to begin building a model.
                  </p>
                </div>
              ) : (
                <div style={styles.projectGrid}>
                  {projects.map((project) => (
                    <article key={project.id} style={styles.projectCard}>
                      <div style={styles.cardTop}>
                        <div style={styles.projectIcon}>AI</div>

                        <span style={styles.statusBadge}>
                          {project.status || "draft"}
                        </span>
                      </div>

                      <div style={styles.projectContent}>
                        <p style={styles.projectId}>PROJECT #{project.id}</p>

                        <h3 style={styles.projectName}>{project.name}</h3>

                        <p style={styles.projectDescription}>
                          {project.description || "No description provided."}
                        </p>
                      </div>

                      <div style={styles.actions}>


                        <Link
                          to={`/projects/${project.id}/builder`}
                          style={styles.linkReset}
                        >
                          <button type="button" style={styles.builderButton}>
                            Builder
                          </button>
                        </Link>

                        <Link
                          to={`/projects/${project.id}/training`}
                          style={styles.linkReset}
                        >
                          <button type="button" style={styles.trainButton}>
                            Train
                          </button>
                        </Link>

                        <button
                          type="button"
                          onClick={() => deleteProject(project.id)}
                          style={styles.deleteButton}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top left, rgba(102, 126, 234, 0.14), transparent 32%), radial-gradient(circle at top right, rgba(139, 92, 246, 0.08), transparent 26%), #111319",
    color: "#f4f6fb",
  },

  main: {
    width: "min(1180px, calc(100% - 40px))",
    margin: "0 auto",
    padding: "64px 0 90px",
  },

  hero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "24px",
    marginBottom: "30px",
  },

  eyebrow: {
    margin: "0 0 12px",
    color: "#9da9ff",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.18em",
  },

  title: {
    margin: 0,
    fontSize: "clamp(38px, 6vw, 64px)",
    lineHeight: 1.05,
    letterSpacing: "-0.045em",
  },

  subtitle: {
    maxWidth: "720px",
    margin: "18px 0 0",
    color: "#aeb5c6",
    fontSize: "17px",
    lineHeight: 1.7,
  },

  heroBadge: {
    flexShrink: 0,
    padding: "10px 14px",
    border: "1px solid rgba(151, 162, 255, 0.25)",
    borderRadius: "999px",
    background: "rgba(107, 116, 247, 0.08)",
    color: "#b7beff",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.08em",
  },

  message: {
    marginBottom: "20px",
    padding: "13px 16px",
    border: "1px solid rgba(129, 140, 248, 0.30)",
    borderRadius: "12px",
    background: "rgba(99, 102, 241, 0.10)",
    color: "#c7d2fe",
  },

  panel: {
    marginBottom: "28px",
    padding: "26px",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: "22px",
    background: "rgba(23, 26, 35, 0.86)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.18)",
  },

  projectsSection: {
    padding: "4px 0 0",
  },

  sectionHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-end",
    gap: "16px",
    marginBottom: "20px",
  },

  sectionNumber: {
    margin: "0 0 8px",
    color: "#7f8cff",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.14em",
  },

  sectionTitle: {
    margin: 0,
    fontSize: "26px",
    letterSpacing: "-0.025em",
  },

  sectionDescription: {
    margin: "7px 0 0",
    color: "#8f98ad",
    lineHeight: 1.6,
  },

  createForm: {
    display: "grid",
    gridTemplateColumns:
      "minmax(220px, 0.8fr) minmax(300px, 1.5fr) auto",
    gap: "16px",
    alignItems: "end",
  },

  field: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },

  label: {
    color: "#c7cbe0",
    fontSize: "13px",
    fontWeight: 800,
  },

  input: {
    height: "46px",
    boxSizing: "border-box",
    padding: "0 14px",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "11px",
    outline: "none",
    background: "#181b24",
    color: "#f4f6fb",
    fontSize: "14px",
  },

  textarea: {
    minHeight: "46px",
    height: "46px",
    boxSizing: "border-box",
    resize: "vertical",
    padding: "12px 14px",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "11px",
    outline: "none",
    background: "#181b24",
    color: "#f4f6fb",
    fontFamily: "inherit",
    fontSize: "14px",
  },

  primaryButton: {
    minHeight: "46px",
    padding: "0 20px",
    border: "1px solid rgba(151, 162, 255, 0.48)",
    borderRadius: "12px",
    background: "linear-gradient(135deg, #6b74f7, #8b5cf6)",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  secondaryButton: {
    minHeight: "40px",
    padding: "0 15px",
    border: "1px solid rgba(151,162,255,0.26)",
    borderRadius: "10px",
    background: "rgba(107,116,247,0.07)",
    color: "#c9ceff",
    fontWeight: 800,
    cursor: "pointer",
  },

  emptyState: {
    padding: "34px",
    border: "1px dashed rgba(255,255,255,0.12)",
    borderRadius: "16px",
    background: "rgba(255,255,255,0.025)",
    textAlign: "center",
    color: "#8f98ad",
  },

  emptyTitle: {
    margin: "0 0 8px",
    color: "#f4f6fb",
  },

  emptyText: {
    margin: "0 0 18px",
    color: "#8f98ad",
  },

  projectGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "18px",
  },

  projectCard: {
    display: "flex",
    flexDirection: "column",
    minHeight: "285px",
    padding: "22px",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: "18px",
    background:
      "linear-gradient(145deg, rgba(27,30,41,0.96), rgba(18,20,28,0.96))",
    boxShadow: "0 18px 45px rgba(0,0,0,0.16)",
  },

  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "22px",
  },

  projectIcon: {
    display: "grid",
    placeItems: "center",
    width: "44px",
    height: "44px",
    border: "1px solid rgba(151,162,255,0.28)",
    borderRadius: "12px",
    background: "rgba(107,116,247,0.12)",
    color: "#b9c0ff",
    fontSize: "12px",
    fontWeight: 900,
  },

  statusBadge: {
    padding: "6px 10px",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: "999px",
    background: "rgba(255,255,255,0.04)",
    color: "#aeb5c6",
    fontSize: "11px",
    fontWeight: 900,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },

  projectContent: {
    flex: 1,
  },

  projectId: {
    margin: "0 0 8px",
    color: "#7f8cff",
    fontSize: "11px",
    fontWeight: 900,
    letterSpacing: "0.12em",
  },

  projectName: {
    margin: "0 0 10px",
    color: "#f4f6fb",
    fontSize: "24px",
    letterSpacing: "-0.025em",
  },

  projectDescription: {
    margin: 0,
    color: "#929aac",
    lineHeight: 1.65,
  },

  actions: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "8px",
    marginTop: "22px",
    paddingTop: "18px",
    borderTop: "1px solid rgba(255,255,255,0.07)",
  },

  linkReset: {
    display: "block",
    textDecoration: "none",
  },

  secondaryActionButton: {
    width: "100%",
    minHeight: "40px",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "9px",
    background: "rgba(255,255,255,0.035)",
    color: "#d2d6e3",
    fontWeight: 800,
    cursor: "pointer",
  },

  builderButton: {
    width: "100%",
    minHeight: "40px",
    border: "1px solid rgba(129,140,248,0.25)",
    borderRadius: "9px",
    background: "rgba(99,102,241,0.08)",
    color: "#b8c0ff",
    fontWeight: 800,
    cursor: "pointer",
  },

  trainButton: {
    width: "100%",
    minHeight: "40px",
    border: "1px solid rgba(151,162,255,0.42)",
    borderRadius: "9px",
    background: "linear-gradient(135deg, #6b74f7, #8b5cf6)",
    color: "#ffffff",
    fontWeight: 900,
    cursor: "pointer",
  },

  deleteButton: {
    width: "100%",
    minHeight: "40px",
    border: "1px solid rgba(248,113,113,0.22)",
    borderRadius: "9px",
    background: "rgba(127,29,29,0.16)",
    color: "#fca5a5",
    fontWeight: 800,
    cursor: "pointer",
  },
};

export default Projects;
