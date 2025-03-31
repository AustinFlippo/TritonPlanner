# AIVac

## Backend

cd app

pip install --upgrade -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8000

## MongoDB Backend

FIRST talk to Noah about connecting to his MongoDB

cd mern

cd server

touch config.env
# (or simply right click and add file in vscode)

# Open config.env and add the following:
# ATLAS_URI=your-mongodb-connection-string
# PORT=5050

npm install

npm run dev

## Frontend

cd mern

cd client

npm install

npm run dev
