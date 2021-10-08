
var cfg;
try {
    var cfail = false;
    cfg = require("./cfg.json");
} catch (e) {
    var fs = require("fs");
    if (e.code === "MODULE_NOT_FOUND") {
        console.log("Config Not found, Generating new one");
        cfail = true;
        cfg = {};
        cfg["token"] = "<Fill in token>";
        cfg["prefixes"] = ["ra!", "@mention"];
        cfg["owners"] =  [];
        fs.writeFile("cfg.json", JSON.stringify(cfg, null, 4)); 
    } else {
        console.error(e);
    }
} finally {
    if (cfg.token === "<Fill in token>" || cfg.owners.length === 0) {
        if (!cfail) {
            console.log("Config file is missing a token and/or the owners array is empty");
        }
        process.exit(1);
    }
}

const Joi = require("joi");
const Eris = require("eris");
const ErisComponents = require("eris-components");
const ReactionHandler = require("eris-reactions");
const prettify = require("ghom-prettify");
const embedvalidation = require("./src/embedvalidation");
const axio = require("axios");
const Promise = require("promise");
const { Sequelize, DataTypes } = require("sequelize");

const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./db.sqlite"
});

var bot;

if (cfg.token) {
    bot = new Eris.CommandClient(`Bot ${cfg.token}`, {}, { ignoreBots: true, prefix: cfg.prefixs, defaultHelpCommand: false });
} else {
    console.log("No token Found");
    process.exit(1);
}

// eslint-disable-next-line no-unused-vars
const client = ErisComponents.Client(bot, { debug: true, invalidClientInstanceError: true, ignoreRequestErrors: false });



//
//             DB models
//

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
    },
    default_embed: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
        get() {
            return JSON.parse(this.getDataValue("default_embed"));
        },
        set(value) {
            this.setDataValue("default_embed", JSON.stringify(value));
        }
    }
}, {
    timestamps: false,
    createdAt: false,
    updatedAt: false,
});

// eslint-disable-next-line no-unused-vars
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


const get_guild = async function (gid) {
    var [guild, created] = await Guild.findOrCreate({ where: { gid: gid }, defaults: { gid: gid } });

    if (created) {
        console.log(`Created guild table for - ${gid}`);
    }
    return guild;
};

const accept_deny_q = async function(msg, user, timeout) {
    await msg.addReaction("✅");
    await msg.addReaction("❌");

    // eslint-disable-next-line no-unused-vars
    return await new Promise((resolve, rejects) => {
        var reactionListener = new ReactionHandler.continuousReactionStream(
            msg,
            (userID) => userID === user.id,
            false,
            { maxMatches: 900, time: timeout }
        );

        reactionListener.on("reacted", (event) => {
            if (event.emoji.name === "✅") {
                reactionListener.stopListening(null);
                resolve(true);
            } else if (event.emoji.name === "❌") {
                reactionListener.stopListening(null);
                resolve(false);

            }
            console.log(event);
        });

    });
};


const embed_getter = async function(msg) {
    if (!msg.attachments > 0) {
        await bot.createMessage(msg.channel.id, `Could not find embed attached with this command\nUpload the file and in the comment do \`${msg.prefix + "setembed"}\` to upload the file with the command`);
        return false;
    }

    var response;
    try {
        response = await axio.get(msg.attachments[0].url);
    } catch (e) {
        console.error(e);
        await bot.createMessage(msg.channel.id, "Ran into error with download json from discord");
        return false;
    }

    var embed;
    try {
        embed = await embedvalidation.validateAsync(response.data.embed, { abortEarly: false });
    } catch (e) {
        if (e instanceof Joi.ValidationError) {
            let embed = {};
            embed["title"] = "Embed validation failed:";
            embed["color"] = 16776960;

            var errors = [];
            for (var counter = 0; counter < e.details.length; counter++) {
                errors.push(e.details[counter].message);
            }
            embed["description"] = errors.join("\n");
            await bot.createMessage(msg.channel.id, { embed });
            return false;
        } else {
            console.error(e);
            await bot.createMessage(msg.channel.id, "Internal error when trying to verify embed - check console");
            return false;
        }
    }
    return embed;
};



//
//              Perm checks
//
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

    var guild = await get_guild(msg.guildID);

    // can't do every/foreach, needs to be in the same name space
    for (var counter = 0; counter < guild.get("required_perms").length; counter++) {
        if (msg.member.permissions.has(guild.get("required_perms")[counter].toLowerCase())) {
            return true;
        }
    }
    return false;
};

bot.registerCommand("prefix", async function(msg, args) {
    if (args.length > 1) {
        return "Too many args given, can be nothing or a prefix (`! ? uwu! rawrxd!`)";
    }
    var guild = await get_guild(msg.guildID);

    if (args.length === 0) {
        var gprefix = null;
        if (!guild.prefix) {
            gprefix = cfg.prefixs.join(", ");
        } else {
            gprefix = guild.prefix;
        }
        return `Current prefix(s): ${gprefix}`;
    }
    
    if (args[0] === "reset") {
        guild.prefix = null;
        guild.save();
        bot.registerGuildPrefix(guild.gid, cfg.prefixs);
        return `Prefix have been reset: ${cfg.prefixs.join(", ")}`;
    }

    bot.registerGuildPrefix(guild.gid, args[0]);
    guild.prefix = args[0];
    guild.save();
    return `Prefix set! \`${guild.prefix}\``;

}, { requirements: { custom: checkdbperm } });



// eslint-disable-next-line no-unused-vars
bot.registerCommand("setdefaultembed", async function(msg, args) {
    var embed = await embed_getter(msg);
    if (!embed) return;
    var embedcheck = await bot.createMessage(msg.channel.id, { content: "React to accept embed :)", embed: embed });
    var answer = await accept_deny_q(embedcheck, msg.author, 60000);
    if (answer) {
        var guild = await get_guild(msg.guildID);
        guild.default_embed = embed;
        guild.save();
        await bot.createMessage(msg.channel.id, "Embed has been saved");
    } else {
        await bot.createMessage(msg.channel.id, "Embed has not been saved");
    }
    await embedcheck.delete();
}, { requirements: { custom: checkdbperm } });



bot.registerCommand("ping", "pong!", { requirements: { custom: checkdbperm }});

// eslint-disable-next-line no-unused-vars
bot.registerCommand("eval", async function(msg, args) {
    if (!cfg.owners.includes(msg.author.id)) {
        return;
    } else {
        let codeInBlock = /^```(?:js)?\s(.+[^\\])```$/is;
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

        embed["title"] = "Discord Eval:";
        embed["description"] = `**Classe** : \`\`${classe}\`\`\n` + `**Type** : \`${typeof out}\``;

        embed["fields"].push({
            "name": "Code ↓",
            "value": `\`\`\`js\n${formatted.length > 0 ? formatted : "void"}`.slice(0, 800) + "\n```",
            "inline": false
        });

        if (editable) await editable.edit(embed);


        if (!`${out}`.includes("Error")) {
            msg.addReaction("✅");
        } else {
            msg.addReaction("❌");
        }


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

bot.on("error", (err) => {
    console.error(err);
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