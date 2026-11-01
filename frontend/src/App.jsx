import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ModelsPage from "./pages/ModelsPage";
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
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/models/:id/builder" element={<BuilderPage />} />
        <Route path="/projects" element={<Navigate to="/models" replace />} />
        <Route path="/projects/:id" element={<BuilderPage />} />
        <Route path="/projects/:id/builder" element={<BuilderPage />} />
        <Route path="/projects/:id/training" element={<TrainingPage />} />
        <Route path="/projects/:id/dataset" element={<DatasetPage />} />
        <Route path="/training" element={<TrainingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
