import MainLayout from "./components/MainLayout";
import { AuthProvider } from "./context/AuthContext";

const App = () => {
  return (
    <AuthProvider>
      <div className="w-full">
        <MainLayout />
      </div>
    </AuthProvider>
  );
};
export default App;
