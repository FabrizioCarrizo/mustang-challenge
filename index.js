const dotenv = require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const path = require("path");
const exphbs = require("express-handlebars");
const renderTable = require("./src/controllers/renderTable");
const scrapingController = require("./src/controllers/scrapingController");
const { interval, port, dbPassword, dbUser } = require("./src/config/config");

const uri = `mongodb+srv://${dbUser}:${dbPassword}@cluster0.zvw1ucv.mongodb.net/standings`;

mongoose.connect(uri);

const server = express();
server.set("views", path.join(__dirname, "src", "views"));

server.engine(
  ".hbs",
  exphbs.engine({
    defaultLayout: "main",
    layoutsDir: path.join(server.get("views"), "layouts"),
    extname: ".hbs",

    helpers: {
      colorTableRow: function (index, totalRows, options) {
        if (index < 4) {
          return (
            '<tr style="background-color: #1e4d2b">' +
            options.fn(this) +
            "</tr>"
          );
        } else if (index >= totalRows - 4) {
          return (
            '<tr style="background-color: #ee0010">' +
            options.fn(this) +
            "</tr>"
          );
        } else {
          return "<tr>" + options.fn(this) + "</tr>";
        }
      },
      section: function (name, options) {
        if (!this._sections) this._sections = {};
        this._sections[name] = options.fn(this);
        return null;
      },
    },
  })
);
server.set("view engine", ".hbs");

server.use(express.static(path.join(__dirname, "public")));

server.get("/", renderTable);

server.listen(port || 3000, () => console.log("Server up and running"));

scrapingController();
setInterval(scrapingController, interval);
