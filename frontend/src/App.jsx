import { BrowserRouter, Routes, Route } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import DatasetPage from "./pages/DatasetPage";
import BuilderPage from "./pages/BuilderPage";
import TrainingPage from "./pages/TrainingPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/datasets" element={<DatasetPage />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/projects/:id/builder" element={<BuilderPage />} />
        <Route path="/projects/:id/training" element={<TrainingPage />} />
        <Route path="/projects/:id/dataset" element={<DatasetPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
