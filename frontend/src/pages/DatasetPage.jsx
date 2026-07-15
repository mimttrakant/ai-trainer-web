import { Link, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";

function DatasetPage() {
  const { id } = useParams();

  return (
    <div>
      <Navbar />

      <div style={{ padding: "40px" }}>
        <Link to={`/projects/${id}`}>← Back to Project</Link>

        <h1>Dataset</h1>
        <p>Project ID: {id}</p>

        <p>Upload and manage dataset here.</p>
      </div>
    </div>
  );
}

export default DatasetPage;