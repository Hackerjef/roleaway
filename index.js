const cfg = require("./cfg.json");

const Eris = require("eris");
const ErisComponents = require("eris-components");
const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./db.sqlite"
});

const Guild = sequelize.define("Guild", {
    // Model attributes are defined here
    gid: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    prefix: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    required_perms: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: JSON.stringify(["administrator"]),
        get() {
            return JSON.parse(this.getDataValue("required_perms"));
        },
        set(value){
            this.setDataValue("required_perms", JSON.stringify(value));
        }
    }
}, {
    timestamps: false,
    createdAt: false,
    updatedAt: false,
});

const Embeds = sequelize.define("Embeds", {
    // Model attributes are defined here
    mid: {
        type: DataTypes.STRING,
        allowNull: false,
        primaryKey: true
    },
    cid: {
        type: DataTypes.STRING,
        allowNull: false
    },
    rid: {
        type: DataTypes.STRING,
        allowNull: false
    },
    role_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0
    },
    role_max: {
        type: DataTypes.STRING,
        allowNull: false
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
    }
}, {
    timestamps: false,
    createdAt: false,
    updatedAt: false,
});

var bot;

if (cfg.token) {
    bot = new Eris.CommandClient(`Bot ${cfg.token}`, {}, { ignoreBots: true, prefix: cfg.prefix });
} else {
    console.log("No token Found");
    process.exit(1);
}

// eslint-disable-next-line no-unused-vars
const client = ErisComponents.Client(bot, { debug: true, invalidClientInstanceError: true, ignoreRequestErrors: false });

//check perm ;)  this.requirements.custom
const checkdbperm = async function (msg) {
    if (!msg.guildID) {
        return false;
    }

    //TODO: Do check
    //var guild = (await Guild.findOrCreate({ where: { gid: msg.guildID }, defaults: { gid: msg.guildID } }));
    // console.log(guild);
    // for (var perm in guild.get("required_perms")) {
    //     console.log(perm);
    //     if (msg.member.hasPermission(perm)) return true;
    // }
    return false;
};


bot.registerCommand("ping", "pong!", { requirements: { custom: checkdbperm }});



bot.on("ready", () => {
    console.log(`Connected with user: ${bot.user.username}#${bot.user.discriminator} (${bot.user.id})` );
    console.log(`"https://discord.com/api/oauth2/authorize?client_id=${bot.application.id}&permissions=68608&scope=bot"`);
});


// reg prefix & put embeds into mem
(async () => {
    // sync db
    await sequelize.sync({ force: true });

    //guild prefix
    var guilds = await Guild.findAll();
    guilds.every(guild => {
        bot.registerGuildPrefix(guild.gid, guild.prefix);
    });

    //finish it up
    bot.connect();
})();