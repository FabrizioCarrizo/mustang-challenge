const dotenv= require('dotenv').config()
const mongoose = require("mongoose");
const express = require("express");
const path = require('path');
const exphbs = require('express-handlebars');
const renderTable = require("./src/controllers/renderTable");
const scrapingControler = require("./src/controllers/scrapingController");
const { interval, port } = require("./src/config/config");


mongoose.connect("mongodb://127.0.0.1:27017/standings");

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
setInterval(scrapingControler, interval)
