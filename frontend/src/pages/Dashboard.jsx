import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";

function Dashboard() {
  const user = getStoredUser();

  return (
    <div style={pageStyle}>
      <Navbar />

      <main style={mainStyle}>
        <section style={heroStyle}>
          <p style={eyebrowStyle}>AI TRAINER PLATFORM</p>
          <h1 style={titleStyle}>
            {user?.username
              ? `Welcome back, ${user.username}`
              : "Build and train AI models visually"}
          </h1>
          <p style={subtitleStyle}>
            Manage datasets, design model architectures, and prepare training
            jobs from one workspace.
          </p>
        </section>

        <section style={gridStyle}>
          <DashboardCard
            number="01"
            title="Dataset Library"
            description="Upload ZIP files or import datasets from Google Drive and manage them in your personal library."
            buttonText="Open Dataset"
            linkTo="/datasets"
          />
          <DashboardCard
            number="02"
            title="Projects"
            description="Create projects and design neural-network architectures with the visual model builder."
            buttonText="Open Projects"
            linkTo="/projects"
          />
          <DashboardCard
            number="03"
            title="Training"
            description="Select a saved project and dataset, configure training settings, and monitor the results."
            buttonText="Open Training"
            linkTo="/projects"
          />
        </section>
      </main>
    </div>
  );
}

function DashboardCard({ number, title, description, buttonText, linkTo }) {
  return (
    <article style={cardStyle}>
      <div style={cardTopRowStyle}>
        <span style={numberStyle}>{number}</span>
        <span style={arrowStyle}>↗</span>
      </div>
      <div>
        <h2 style={cardTitleStyle}>{title}</h2>
        <p style={cardDescriptionStyle}>{description}</p>
      </div>
      <Link to={linkTo} style={linkStyle}>
        <button type="button" style={primaryButtonStyle}>
          {buttonText}
        </button>
      </Link>
    </article>
  );
}

function getStoredUser() {
  try {
    const rawUser = localStorage.getItem("user");
    return rawUser ? JSON.parse(rawUser) : null;
  } catch {
    return null;
  }
}

const pageStyle = { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(102, 126, 234, 0.14), transparent 32%), #111319", color: "#f4f6fb" };
const mainStyle = { width: "min(1180px, calc(100% - 40px))", margin: "0 auto", padding: "70px 0 90px" };
const heroStyle = { maxWidth: "760px", marginBottom: "46px" };
const eyebrowStyle = { margin: "0 0 14px", color: "#9da9ff", fontSize: "13px", fontWeight: "800", letterSpacing: "0.18em" };
const titleStyle = { margin: 0, fontSize: "clamp(38px, 6vw, 70px)", lineHeight: 1.05, letterSpacing: "-0.045em" };
const subtitleStyle = { maxWidth: "690px", margin: "22px 0 0", color: "#aeb5c6", fontSize: "18px", lineHeight: 1.7 };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" };
const cardStyle = { minHeight: "330px", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "26px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "22px", background: "rgba(23, 26, 35, 0.86)", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" };
const cardTopRowStyle = { display: "flex", alignItems: "center", justifyContent: "space-between" };
const numberStyle = { color: "#7f8cff", fontSize: "13px", fontWeight: "800", letterSpacing: "0.12em" };
const arrowStyle = { color: "#c9ceff", fontSize: "22px" };
const cardTitleStyle = { margin: "0 0 12px", fontSize: "29px", letterSpacing: "-0.025em" };
const cardDescriptionStyle = { minHeight: "96px", margin: 0, color: "#aeb5c6", lineHeight: 1.65 };
const linkStyle = { textDecoration: "none" };
const primaryButtonStyle = { width: "100%", minHeight: "46px", border: "1px solid rgba(151, 162, 255, 0.48)", borderRadius: "12px", background: "linear-gradient(135deg, #6b74f7, #8b5cf6)", color: "#ffffff", fontSize: "15px", fontWeight: "800", cursor: "pointer" };

export default Dashboard;
