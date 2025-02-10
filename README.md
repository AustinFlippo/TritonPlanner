# AIVac

Frontend is a REACT frontend webapp and vacaiback is a FastAPI backend server that executes LLM commands using langchain. This will be updated in the future so there is another layer between the frontend and AI backend that manages user information and past conversation information using express and mongodb, the skeleton for this code is in mern/server, this currently uses mogodb atlas cluster in Saaz's account.


## Docker

To run using docker, pull images from https://hub.docker.com/u/saazm

Make sure to pull and run both saazm/vacfront and saazm/vacaiback

Run:

docker pull saazm/vacfront
docker pull saazm/vacaiback

Go to Docker Desktop --> images
<img width="1461" alt="Screenshot 2025-02-10 at 8 23 24 AM" src="https://github.com/user-attachments/assets/05ad973a-8939-407e-957f-3a9b4cfb1bd1" />

When running each container make sure to open optional settings and copy the port number to "Host Port"
<img width="633" alt="Screenshot 2025-02-10 at 8 23 51 AM" src="https://github.com/user-attachments/assets/3e40cec6-ed32-4e1b-9266-8b3fe565f8b8" />

Go to Containers --> [container name] --> logs to make sure images are running(do this for both frontend and backend)
Backend running on - http://0.0.0.0:8000
Frontend running on(open this link to test) - http://localhost:3000 


## Regular

### Backend

cd app

pip install --upgrade -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8000

### Frontend

cd frontned

npm install or(if the first one fails) npm install --legacy-peer-deps

npm run dev



