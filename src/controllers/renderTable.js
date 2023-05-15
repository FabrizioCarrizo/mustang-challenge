const Team = require("../models/Team");

const renderTable= async (req,res )=>{
    const teamsFromDB = await Team.find().sort({position: 1}).lean();
try{
    res.render("table", { standingsData: teamsFromDB });
}catch (error) {
    console.error(error);
    res.render("error");
  }
}


module.exports= renderTable;