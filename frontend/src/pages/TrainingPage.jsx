import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";

function TrainingPage() {
  const { id } = useParams();

  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px" }}>
        <Link to={`/projects/${id}`}>← Back to Project</Link>

        <h1>Training</h1>
        <p>Project ID: {id}</p>

        <p>Training dashboard with loss / accuracy graphs will be here.</p>
      </div>
    </div>
  );
}

export default TrainingPage;