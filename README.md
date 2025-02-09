# AIVac

Frontend is a REACT frontend webapp and vacaiback is a FastAPI backend server that executes LLM commands using langchain. This will be updated in the future so there is another layer between the frontend and AI backend that manages user information and past conversation information using express and mongodb, the skeleton for this code is in mern/server, this currently uses mogodb atlas cluster in Saaz's account.


## Docker

To run using docker, pull images from https://hub.docker.com/u/saazm

Make sure to pull and run both saazm/vacfront and saazm/vacaiback


## Regular

### Backend

cd app

pip install --upgrade -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8000

### Frontend

cd frontned

npm install or(if the first one fails) npm install --legacy-peer-deps

npm run dev



