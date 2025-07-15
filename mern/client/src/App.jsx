import MainLayout from "./components/MainLayout";
import { MobileUIProvider } from "./context/MobileUIContext";

const App = () => {
  return (
    <MobileUIProvider>
      <div className="w-full">
        <MainLayout />
      </div>
    </MobileUIProvider>
  );
};
export default App;
