const cheerio = require("cheerio");
const Team = require("../models/Team");

const getStandingsData = async (table) => {
  const $ = cheerio.load(table);
  const data = [];

  $("tr").each(async (i, el) => {
    if (i === 0) return;

    const position = $(el).find("td").eq(0).text();
    const logo = $(el).find("td").eq(1).find("img").attr("data-src");
    const name = $(el).find("td").eq(1).find("span").first().text();
    const played = $(el).find("td").eq(2).text();
    const won = $(el).find("td").eq(3).text();
    const draw = $(el).find("td").eq(4).text();
    const lost = $(el).find("td").eq(5).text();
    const goalsScored = $(el).find("td").eq(6).text();
    const goalsAgainst = $(el).find("td").eq(7).text();
    const goalDiff = $(el).find("td").eq(8).text().trim();
    const points = $(el).find("td").eq(9).text();

    const teamData = {
      position,
      logo,
      name,
      played,
      won,
      draw,
      lost,
      goalsScored,
      goalsAgainst,
      goalDiff,
      points,
    };

    data.push(teamData);

    if (data.length === 28) {
      try {
        const docs = await Team.find({});

        for (const teamData of data) {
          const doc = docs.find(
            (doc) => doc.name.toLowerCase() === teamData.name.toLowerCase()
          );

          if (
            !doc ||
            doc.played != teamData.played ||
            doc.position != teamData.position
          ) {
            await Team.findOneAndUpdate({ name: teamData.name }, teamData, {
              upsert: true,
            }).then(() => console.log("Data successfully updated"));

          }
         

        }
      } catch (error) {
        console.error(error);
      }
    }
  });

  return Team.find();
};

module.exports = getStandingsData;
