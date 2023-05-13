const dotenv= require('dotenv').config()
const mongoose = require("mongoose");
const express = require("express");
const path = require('path');
const exphbs = require('express-handlebars');
const renderTable = require("./src/controllers/renderTable");
const scrapingControler = require("./src/controllers/scrapingController");
const { interval, port, dbPassword, dbUser } = require("./src/config/config");

const uri = `mongodb+srv://${dbUser}:${dbPassword}@cluster0.zvw1ucv.mongodb.net/standings`;

mongoose.connect(uri);

const server = express();
server.set('views', path.join(__dirname, 'src', 'views'));

server.engine('.hbs', exphbs.engine({
  defaultLayout: 'main',
  layoutsDir: path.join(server.get('views'), 'layouts'),
  extname: '.hbs'
}));
server.set('view engine', '.hbs');

server.use(express.static(path.join(__dirname, 'public')));

server.get("/", renderTable);

server.listen(port|| 3000, () => console.log("Server up and running"));


scrapingControler();
setInterval(scrapingControler, interval);
