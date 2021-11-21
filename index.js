
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
const { v4: uuidv4 } = require("uuid");
const traverse = require('traverse');


const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./db.sqlite"
});

var bot;

if (cfg.token) {
    // getallnewusers
    bot = new Eris.CommandClient(`Bot ${cfg.token}`, { intents: 1819, getAllUsers: true, messageLimit: 10 }, { ignoreBots: true, prefix: cfg.prefixs, defaultHelpCommand: false });
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
    rid: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null
    },
    cid: {
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
    finish_embed: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: JSON.stringify({ "title": "Last role has been given out!", "color": 15406156 }),
        get() {
            return JSON.parse(this.getDataValue("finish_embed"));
        },
        set(value) {
            this.setDataValue("finish_embed", JSON.stringify(value));
        }
    },
    default_embed: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: JSON.stringify({ "title": "Click here for role :)", "color": 5793266 }),
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

const Embeds = sequelize.define("Embeds", {
    // Model attributes are defined here
    id: {
        type: DataTypes.UUIDV4,
        allowNull: false,
        defaultValue: function() {
            return uuidv4()
        },
        primaryKey: true
    },
    gid: {
        type: DataTypes.STRING,
        allowNull: false
    },
    mid: {
        type: DataTypes.STRING,
        allowNull: true,
        defaultValue: null,
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
    embed: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        get() {
            return JSON.parse(this.getDataValue("embed"));
        },
        set(value) {
            this.setDataValue("embed", JSON.stringify(value));
        }
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
    // eslint-disable-next-line no-unused-vars
    await msg.addReaction("✅").catch(err => {});
    // eslint-disable-next-line no-unused-vars
    msg.addReaction("❌").catch(err => { });

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
        });

    });
};


const format_embed = async function(embed, remaining, max) {
    var fembed = JSON.parse(JSON.stringify(embed));
    traverse(fembed).forEach(function (x) {
        if (typeof x == 'string') {
            updated = x.replace("{remaining}", remaining)
            updated = updated.replace("{max}", max)
            this.update(updated)
        }
    });
    return fembed
}


const get_embed_attachment = async function(msg) {
    var response;
    try {
        response = await axio.get(msg.attachments[0].url);
    } catch (e) {
        console.error(e);
        await bot.createMessage(msg.channel.id, "Ran into error with download json from discord");
        return false;
    }

    var data;
    if (Object.prototype.hasOwnProperty.call(response.data, "embed")) {
        data = response.data.embed;
    } else {
        data = response.data;
    }


    var embed;
    var badembed;
    try {
        embed = await embedvalidation.validateAsync(data, { abortEarly: false });
    } catch (e) {
        if (e instanceof Joi.ValidationError) {
            badembed = {};
            badembed["title"] = "Embed validation failed:";
            badembed["color"] = 16776960;

            var errors = [];
            for (var counter = 0; counter < e.details.length; counter++) {
                errors.push(e.details[counter].message);
            }
            badembed["description"] = errors.join("\n");
            await bot.createMessage(msg.channel.id, { embed: badembed });
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

    // can't do every/foreach, needs to be in the same namespace
    for (var counter = 0; counter < guild.get("required_perms").length; counter++) {
        if (msg.member.permissions.has(guild.get("required_perms")[counter].toLowerCase())) {
            return true;
        }
    }
    return false;
};


//
//              Boi what the fuck I hate intergrations
//
client.on("interactionCreate", async function (resBody) {
    var uuid_dirty = resBody.data.custom_id.match("GR_(.*)");
    if (!uuid_dirty == 2) return await client.replyInteraction(resBody, null, "Cannot give role | UUID does not match", { ephemeral: 1 << 6 });
    var dbe = await Embeds.findByPk(uuid_dirty[1]);
    if (!dbe) return await client.replyInteraction(resBody, null, "Cannot give role | UUID not found", { ephemeral: 1 << 6 });
    if (!dbe.enabled) return await client.replyInteraction(resBody, null, "Max roles given Sorry! ", { ephemeral: 1 << 6 });
    if (!dbe.gid === resBody.guild_id) return await client.replyInteraction(resBody, null, "Cannot Give role | Embed/button not related to guild ", { ephemeral: 1 << 6 });   
    var guild = await bot.guilds.get(dbe.gid);
    if (!guild) return await client.replyInteraction(resBody, null, "Cannot give role | Guild does not exist", { ephemeral: 1 << 6 });
    var member = await guild.members.find((member) => member.id === resBody.member.user.id);
    if (!member) return await client.replyInteraction(resBody, null, "Cannot give role | Aparently you do not exist in this guild 🤔", { ephemeral: 1 << 6 });
    if (member.roles.includes(dbe.rid)) return await client.replyInteraction(resBody, null, "You already have the role, Congrats 🎉", { ephemeral: 1 << 6 });

    // Double check
    if (dbe.role_count >= dbe.role_max) {
        return await client.replyInteraction(resBody, null, "Max roles given Sorry! ", { ephemeral: 1 << 6 });
    }

    member.addRole(dbe.rid, `added from embed - ${dbe.mid || "None"}`).then(async function () {
        await client.replyInteraction(resBody, null, "Role has been assigned :)", { ephemeral: 1 << 6 });
        dbe.role_count = dbe.role_count + 1;
        if (dbe.role_count >= dbe.role_max) {
            dbe.enabled = false;
            var guild = await get_guild(dbe.gid);
            var Button = new ErisComponents.Button()
                .setLabel("Click me for role!")
                .setID(`GR_${dbe.id}`)
                .setStyle("red")
                .setDisabled();
            await client.editComponents(resBody.message, Button, { embed: guild.finish_embed });
        } 
        await dbe.save();
        // fuck ratelimits
        if (dbe.role_count < dbe.role_max) { 
            m = await bot.getMessage(dbe.cid, dbe.mid)
            await m.edit({ embed: await format_embed(dbe.embed, dbe.role_max - dbe.role_count, dbe.role_max) })
        }
        return;
    }).catch(async function (e) {
        console.error(e);
        if (!e) return await client.replyInteraction(resBody, null, "Cannot give role | Role cannot be assigned", { ephemeral: 1 << 6 });
        if (e.code === 50001) {
            return await client.replyInteraction(resBody, null, "Cannot give role | Missing Access", { ephemeral: 1 << 6 });
        } else {
            return await client.replyInteraction(resBody, null, "Cannot give role | Discord returned an unknown error", { ephemeral: 1 << 6 });
        }
    });
});


bot.registerCommand("prefix", async function(msg, args) {
    if (args.length > 1) {
        return "Too many args given, can be nothing or a prefix";
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
bot.registerCommand("set_dembed", async function(msg, args) {
    if (!msg.attachments > 0) {
        return `Could not find embed attached with this command\nUpload the file and in the comment do \`${msg.prefix + "setembed"}\` to upload the file with the command`;
    }
    var embed = await get_embed_attachment(msg);
    if (!embed) return;

    var embedcheck = await bot.createMessage(msg.channel.id, { content: "React to accept embed :)", embed: await format_embed(embed, 0, 0) });
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


// eslint-disable-next-line no-unused-vars
bot.registerCommand("set_fembed", async function (msg, args) {
    if (!msg.attachments > 0) {
        return `Could not find embed attached with this command\nUpload the file and in the comment do \`${msg.prefix + "setembed"}\` to upload the file with the command`;
    }
    var embed = await get_embed_attachment(msg);
    if (!embed) return;

    var embedcheck = await bot.createMessage(msg.channel.id, { content: "React to accept embed :)", embed: embed });
    var answer = await accept_deny_q(embedcheck, msg.author, 60000);
    if (answer) {
        var guild = await get_guild(msg.guildID);
        guild.finish_embed = embed;
        guild.save();
        await bot.createMessage(msg.channel.id, "Embed has been saved");
    } else {
        await bot.createMessage(msg.channel.id, "Embed has not been saved");
    }
    await embedcheck.delete();
}, { requirements: { custom: checkdbperm } });




//<p> rid
bot.registerCommand("set_role", async function(msg, args) {
    if (!args.length > 0) return `Role not given, \`${msg.prefix}set_role rid`;
    if (!msg.channel.guild.roles.has(args[0])) return "Role does not exist in this guild";

    var guild = await bot.guilds.get(msg.guildID);
    var guilddb = await get_guild(msg.guildID);
    var r = guild.roles.find(role => { return role.id === args[0]})
    if (typeof r == 'undefined') {
        return "Provided role is invalid"
    }

    if (r.permissions.has("administrator")) {
        return "Provided role has administrator, not setting"
    }


    guilddb.rid = args[0];
    guilddb.save();
    return `Role has been set to: \`${args[0]}\``;
}, { requirements: { custom: checkdbperm } });

bot.registerCommand("set_channel", async function (msg, args) {
    if (!args.length > 0) return `channel not given, \`${msg.prefix}set_channel cid`;
    if (!msg.channel.guild.channels.has(args[0])) return "channel does not exist in this guild";

    var guild = await bot.guilds.get(msg.guildID);
    var guilddb = await get_guild(msg.guildID);

    var c = guild.channels.find(channel => { return channel.id === args[0]})

    if (typeof c == 'undefined') {
        return "Provided channel is invalid"
    }
    var perms = c.permissionsOf(bot.user.id)

    if (!perms.has("sendMessages") || !perms.has("viewChannel") || !perms.has("embedLinks")) {
        mperms = []
        if (!perms.has("sendMessages")) mperms.push("sendmessages")
        if (!perms.has("viewChannel")) mperms.push("viewchannel")
        if (!perms.has("embedLinks")) mperms.push("embedlinks")
        return `Bot is missing \`${mperms.join(" ,")}\` perms in channel`
    }
    guilddb.cid = args[0];
    guilddb.save();
    return `channel has been set to: \`${args[0]}\``;
}, { requirements: { custom: checkdbperm } });



//<p> count
// eslint-disable-next-line no-unused-vars
bot.registerCommand("post", async function(msg, args) {
    if (args.length > 3 || args.length < 1) return `unspecified args given: \`${msg.prefix}post count (r:id/c:id)\`\nexample: \`${msg.prefix}post 1\` \`${msg.prefix}post 1 rid:0000000000000000000 cid:0000000000000000000\``;
    
    var guild = await bot.guilds.get(msg.guildID);
    var guilddb = await get_guild(msg.guildID);

    // rid
    rid = args.find(x => { return x.includes("rid:")}) 
    if (typeof rid == 'undefined') {
        if (guilddb.rid) {
            rid = guilddb.rid
        } else {
            return `default role has not been set, set it using ${msg.prefix}set_role roleid OR include it with rid:000000000000`
        }
    }
    rid = rid.replace("rid:", "")

    var r = guild.roles.find(role => { return role.id === rid})
    if (typeof r == 'undefined') {
        return `default/provided role is not found`
    }

    if (r.permissions.has("administrator")) {
        return "default/provided role has administrator not posting"
    }


    
    cid = args.find(x => { return x.includes("cid:")})
    if (typeof cid == 'undefined') {
        if (guilddb.cid) {
            cid = guilddb.cid
        } else {
            return `Default channel has not been set, set it using ${msg.prefix}set_channel channelid OR include it with cid:000000000000`
        }
    }
    cid = cid.replace("cid:", "")
    // get permission of channel
    var c = guild.channels.find(channel => { return channel.id === cid})
    if (typeof c == 'undefined') {
        return "Provided/default channel is invalid"
    }

    var perms = c.permissionsOf(bot.user.id)
    if (!perms.has("sendMessages") || !perms.has("viewChannel") || !perms.has("embedLinks")) {
        mperms = []
        if (!perms.has("sendMessages")) mperms.push("sendmessages")
        if (!perms.has("viewChannel")) mperms.push("viewchannel")
        if (!perms.has("embedLinks")) mperms.push("embedlinks")
        return `Bot is missing \`${mperms.join(" ,")}\` perms in channel`
    }



    //check if embed was given or have a default
    var embed;
    if (msg.attachments > 1) {
        embed = await get_embed_attachment(msg);
        if (!embed) return
    } else if (guilddb.default_embed) {
        embed = guilddb.default_embed;
        
    } else {
        return `No embed set (default or given as a attachment) Please set a default (${msg.prefix}set_dembed) or attach json file of an embed of command`;
    }

    var mcount = parseInt(args[0]);
    if (isNaN(mcount)) return "arg is not a number, please give a number to set the amount of roles to give out";
     
    var edb = await Embeds.create({ mid: null, gid: guilddb.gid, cid: cid, rid: rid, role_count: 0, role_max: mcount, enabled: true, embed: embed });

    var Button = new ErisComponents.Button()
        .setLabel("Click me for role!")
        .setID(`GR_${edb.id}`)
        .setStyle("blurple");

    var fmsg = await client.sendComponents(cid, Button, { embed: await format_embed(embed, mcount - edb.role_count, mcount) });
    edb.mid = fmsg.id;
    edb.save();
    msg.addReaction("✅");
}, { requirements: { custom: checkdbperm } });


bot.registerCommand("ping", "pong!", { requirements: { custom: checkdbperm }});


// TODO: async no return content
// eslint-disable-next-line no-unused-vars
bot.registerCommand("eval", async function(msg, args) {
    if (!cfg.owners.includes(msg.author.id)) {
        return;
    } else {
        var codeInBlock = /^```(?:js)?\s(.+[^\\])```$/is;
        var code = msg.content.replace(msg.prefix +"eval", "").trim();
        var editable = null;

        code = code.trim();
        if (codeInBlock.test(code)) {
            code = code.replace(codeInBlock, "$1");
        }

        if (code.includes("resolve") && !code.includes("new Promise")) {
            code = `return await new Promise(resolve => {${code})`;
        }

        if (code.includes("await")) {
            code = `async () => {${code}}`;

            var embed = {};
            embed["title"] = "Discord Eval:";
            embed["description"] = "Running eval";

            editable = await bot.createMessage(msg.channel.id, { embed: embed });
            await msg.channel.sendTyping();

        } else {
            code = `() => {${code}}`;
        }

        var out = null;
        try {
            out = await eval(code)();
        } catch (err) {
            out = err;
        }

        var classe = "void";
        if (out !== undefined && out !== null) {
            classe = out.constructor.name;
        }

        var formatted = code;
        try {
            formatted = await prettify(code, "js");

        // eslint-disable-next-line no-empty
        } catch (err) { }

        var deembed = {};
        deembed["fields"] = [];

        deembed["title"] = "Discord Eval:";
        deembed["description"] = `**Classe** : \`\`${classe}\`\`\n` + `**Type** : \`${typeof out}\``;

        deembed["fields"].push({
            "name": "Code ↓",
            "value": `\`\`\`js\n${formatted.length > 0 ? formatted : "void"}`.slice(0, 800) + "\n```",
            "inline": false
        });

        if (editable) await editable.edit({ embed: deembed });


        if (!`${out}`.includes("Error")) {
            msg.addReaction("✅");
        } else {
            msg.addReaction("❌");
        }


        if (code.includes("return") || `${out}`.includes("Error")) {
            var embed_return = {};
            embed_return["title"] = "Return ↓";
            embed_return["description"] = `\`\`\`js\n${`${out}`.length > 0 ? `${out}` : "void"}`.slice(0, 1800) + "\n```";

            await bot.createMessage(msg.channel.id, { embed: embed_return });
        }
    }
}, { requirements: { custom: isowner } });


bot.on("ready", () => {
    console.log(`Connected with user: ${bot.user.username}#${bot.user.discriminator} (${bot.user.id})` );
    console.log(`"https://discord.com/api/oauth2/authorize?client_id=${bot.application.id}&permissions=378225888320&scope=bot"`);
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