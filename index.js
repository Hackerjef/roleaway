const cfg = require("./cfg.json");

const Eris = require("eris");
const prettify = require("ghom-prettify");
const ErisComponents = require("eris-components");
const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./db.sqlite"
});

var bot;

if (cfg.token) {
    bot = new Eris.CommandClient(`Bot ${cfg.token}`, {}, { ignoreBots: true, prefix: cfg.prefix, defaultHelpCommand: false });
} else {
    console.log("No token Found");
    process.exit(1);
}


// eslint-disable-next-line no-unused-vars
const client = ErisComponents.Client(bot, { debug: true, invalidClientInstanceError: true, ignoreRequestErrors: false });


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


//check perm ;)  this.requirements.custom
const isowner = function(msg) {
    if (cfg.owners.includes(msg.author.id)) {
        return true;
    } else {
        return false;
    }
};

const checkdbperm = async function (msg) {
    if (isowner(msg)) {
        return true;
    }
    
    if (!msg.guildID) {
        return false;
    }

    var [guild, created] = await Guild.findOrCreate({ where: { gid: msg.guildID }, defaults: { gid: msg.guildID } });
    
    if (created) {
        console.log(`Created guild table for - ${msg.guildID}`);
    }

    // can't do every/foreach, needs to be in the same name space
    for (var counter = 0; counter < guild.get("required_perms").length; counter++) {
        if (msg.member.permissions.has(guild.get("required_perms")[counter].toLowerCase())) {
            return true;
        }
    }
    return false;
};


bot.registerCommand("ping", "pong!", { requirements: { custom: checkdbperm }});

const codeInBlock = /^```(?:js)?\s(.+[^\\])```$/is;
bot.registerCommand("eval", async function(msg, args) {
    if (!cfg.owners.includes(msg.author.id)) {
        return;
    } else {
        let code = msg.content.replace(msg.prefix +"eval", "").trim();
        let editable = null;

        code = code.trim();
        if (codeInBlock.test(code)) {
            code = code.replace(codeInBlock, "$1");
        }

        if (code.includes("resolve") && !code.includes("new Promise")) {
            code = `return await new Promise(resolve => {${code})`;
        }

        if (code.includes("await")) {
            code = `async () => {${code}}`;

            let embed = {};
            embed["title"] = "Discord Eval:";
            embed["description"] = "Running eval";

            editable = await bot.createMessage(msg.channel.id, { embed });
            await msg.channel.sendTyping();

        } else {
            code = `() => {${code}}`;
        }

        let out = null;
        try {
            out = await eval(code)();
        } catch (err) {
            out = err;
        }

        let classe = "void";
        if (out !== undefined && out !== null) {
            classe = out.constructor.name;
        }

        let formatted = code;
        try {
            formatted = await prettify(code, "js");
        // eslint-disable-next-line no-empty
        } catch (err) { }

        let embed = {};
        embed["fields"] = [];

        embed["title"] = "Discord Eval:"
        embed["description"] = `**Classe** : \`\`${classe}\`\`\n` + `**Type** : \`${typeof out}\``

        embed["fields"].push({
            "name": "Code ↓",
            "value": `\`\`\`js\n${formatted.length > 0 ? formatted : "void"}`.slice(0, 800) + "\n```",
            "inline": false
        });

        if (editable) await editable.edit(embed);

        if (code.includes("return") || `${out}`.includes("Error")) {
            let embed = {};
            embed["title"] = "Return ↓";
            embed["description"] = `\`\`\`js\n${`${out}`.length > 0 ? `${out}` : "void"}`.slice(0, 1800) + "\n```";

            await bot.createMessage(msg.channel.id, { embed });
        }
    }
}, { requirements: { custom: isowner } });


bot.on("ready", () => {
    console.log(`Connected with user: ${bot.user.username}#${bot.user.discriminator} (${bot.user.id})` );
    console.log(`"https://discord.com/api/oauth2/authorize?client_id=${bot.application.id}&permissions=68608&scope=bot"`);
});


// reg prefix & put embeds into mem
(async () => {
    // sync db
    await sequelize.sync({ force: false });

    //guild prefix
    var guilds = await Guild.findAll();
    guilds.every(guild => {
        if (guild.prefix) {
            bot.registerGuildPrefix(guild.gid, guild.prefix);
        }
    });

    //finish it up
    bot.connect();
})();