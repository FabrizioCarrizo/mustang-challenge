const {Schema, model}= require('mongoose')

const teamSchema= new Schema({
    position: Number,
    logo: String,
    name: String,
    played: Number,
    won:Number,
    draw:Number,
    lost:Number,
    goalsScored:Number,
    goalsAgainst:Number,
    goalDiff: Number,
    points: Number,


 
})


module.exports=model('Team', teamSchema);