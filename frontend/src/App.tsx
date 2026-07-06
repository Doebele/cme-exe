import { Routes, Route } from "react-router-dom";
import Lab from "./Lab";
import Admin from "./Admin";

export default function App() {
  return (
    <div className="scanlines vignette">
      <Routes>
        <Route path="/" element={<Lab />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </div>
  );
}
