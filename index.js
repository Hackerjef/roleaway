
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
const traverse = require("traverse");


const sequelize = new Sequelize({
    dialect: "sqlite",
    storage: "./db.sqlite",
    logQueryParameters: false,
    logging: false
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
const client = ErisComponents.Client(bot, { debug: false, invalidClientInstanceError: false, ignoreRequestErrors: false });
var running_givaways = {};

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


var finished_givaways = [];
const process_winners = async function (id) {
    if (finished_givaways.includes(id)) return false;
    finished_givaways.push(id);
    var giveaway = running_givaways[id];
    console.log(`Processing winners for ${id} members to give: ${giveaway['members'].length} max_roles: ${giveaway['role_max']}`);
    var guild = await bot.guilds.get(giveaway["gid"]);
    // process winners and give roles
    roles_given = 0
    giveaway["members"].forEach(async function(id) {
        if (roles_given > giveaway['role_max']) return console.log(`${id}: Max amount of roles given, Stoping...`)
        console.log(`${id}: Giving role ${giveaway['rid']} to user ${id}`)
        var member = await guild.members.find((member) => member.id === id);
        await member.addRole(giveaway['rid'], `added from embed - ${giveaway["mid"] || "None"}`)
        .then(function() {
            roles_given++
        })
        .catch(async function (e) {
            console.error(e);
        });

    });
};

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
        // eslint-disable-next-line quotes
        if (typeof x == 'string') {
            var updated = x.replace("{remaining}", remaining);
            updated = updated.replace("{max}", max);
            this.update(updated);
        }
    });
    return fembed;
};


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
client.on("componentInteract", async function (resBody) {
    var uuid_dirty = resBody.data.custom_id.match("GR_(.*)_(.*)");
    if (uuid_dirty.length != 3) return await client.replyInteraction(resBody, null, "Malformed interaction.", { ephemeral: 1 << 6 });
    if (uuid_dirty[2] == "_notready") return await client.replyInteraction(resBody, null, "Cannot give role | Interaction Not Ready", { ephemeral: 1 << 6 });
    if (!running_givaways[uuid_dirty[1]]) return await client.replyInteraction(resBody, null, "Cannot give role | UUID not found", { ephemeral: 1 << 6 });
    if (running_givaways[uuid_dirty[1]]["finished"]) return await client.replyInteraction(resBody, null, "Max roles given Sorry! ", { ephemeral: 1 << 6 });
    if (!running_givaways[uuid_dirty[1]]["gid"] === resBody.guild_id) return await client.replyInteraction(resBody, null, "Cannot Give role | Embed/button not related to guild ", { ephemeral: 1 << 6 });
    if (running_givaways[uuid_dirty[1]]["members"].includes(resBody.member.user.id)) return await client.replyInteraction(resBody, null, "You have already entered to get a role!\n**Roles will be given when last role is given out!** 🎉", { ephemeral: 1 << 6 });
    if (running_givaways[uuid_dirty[1]]["role_count"] >= running_givaways[uuid_dirty[1]]["role_max"]) return await client.replyInteraction(resBody, null, "Max roles given Sorry! ", { ephemeral: 1 << 6 });
    running_givaways[uuid_dirty[1]]["members"].push(resBody.member.user.id);
    running_givaways[uuid_dirty[1]]["role_count"]++;
    await client.replyInteraction(resBody, null, "You have been entered to get a role!\nRoles will be given when last role is given out! 🎉", { ephemeral: 1 << 6 });
    
    var m = await bot.getMessage(running_givaways[uuid_dirty[1]]["cid"], running_givaways[uuid_dirty[1]]["mid"]);
    // TODO: Replace m. with it built in
    if (running_givaways[uuid_dirty[1]]["role_count"] >= running_givaways[uuid_dirty[1]]["role_max"]) {
        running_givaways[uuid_dirty[1]]["finished"] = true;
        var Button = new ErisComponents.Button()
            .setLabel("Click me for role!")
            .setID(`GR_${uuid_dirty[1]}`)
            .setStyle("red")
            .setDisabled();
        var gdb = await get_guild(resBody.guild_id);
        await client.editComponents(resBody.message, Button, { embed: gdb.finish_embed });
        await m.edit({ embed: gdb.finish_embed });
        await process_winners(uuid_dirty[1]);
    } else {
        await m.edit({ embed: await format_embed(running_givaways[uuid_dirty[1]]["embed"], running_givaways[uuid_dirty[1]]["role_max"] - running_givaways[uuid_dirty[1]]["role_count"], running_givaways[uuid_dirty[1]]["role_max"]) });
    }
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
    var r = guild.roles.find(role => { return role.id === args[0];});
    if (typeof r == "undefined") {
        return "Provided role is invalid";
    }

    if (r.permissions.has("administrator")) {
        return "Provided role has administrator, not setting";
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

    var c = guild.channels.find(channel => { return channel.id === args[0];});

    if (typeof c == "undefined") {
        return "Provided channel is invalid";
    }
    var perms = c.permissionsOf(bot.user.id);

    if (!perms.has("sendMessages") || !perms.has("viewChannel") || !perms.has("embedLinks")) {
        var mperms = [];
        if (!perms.has("sendMessages")) mperms.push("sendmessages");
        if (!perms.has("viewChannel")) mperms.push("viewchannel");
        if (!perms.has("embedLinks")) mperms.push("embedlinks");
        return `Bot is missing \`${mperms.join(" ,")}\` perms in channel`;
    }
    guilddb.cid = args[0];
    guilddb.save();
    return `channel has been set to: \`${args[0]}\``;
}, { requirements: { custom: checkdbperm } });



//<p> count
// eslint-disable-next-line no-unused-vars
bot.registerCommand("post", async function(msg, args) {
    if (args.length > 3 || args.length < 1) return `unspecified args given:\n\`${msg.prefix}post count (r:id/c:id)\`\n\`${msg.prefix}post 1 rid:0000000000000000000 cid:0000000000000000000\``;
    
    var guild = await bot.guilds.get(msg.guildID);
    var guilddb = await get_guild(msg.guildID);

    // rid
    var rid = args.find(x => { return x.includes("rid:");}); 
    if (typeof rid == "undefined") {
        if (guilddb.rid) {
            rid = guilddb.rid;
        } else {
            return `default role has not been set, set it using ${msg.prefix}set_role roleid OR include it with rid:000000000000`;
        }
    }
    rid = rid.replace("rid:", "");

    var r = guild.roles.find(role => { return role.id === rid;});
    if (typeof r == "undefined") {
        return "default/provided role is not found";
    }

    if (r.permissions.has("administrator")) {
        return "default/provided role has administrator not posting";
    }


    
    var cid = args.find(x => { return x.includes("cid:");});
    if (typeof cid == "undefined") {
        if (guilddb.cid) {
            cid = guilddb.cid;
        } else {
            return `Default channel has not been set, set it using ${msg.prefix}set_channel channelid OR include it with cid:000000000000`;
        }
    }
    cid = cid.replace("cid:", "");
    // get permission of channel
    var c = guild.channels.find(channel => { return channel.id === cid;});
    if (typeof c == "undefined") {
        return "Provided/default channel is invalid";
    }

    var perms = c.permissionsOf(bot.user.id);
    if (!perms.has("sendMessages") || !perms.has("viewChannel") || !perms.has("embedLinks")) {
        var mperms = [];
        if (!perms.has("sendMessages")) mperms.push("sendmessages");
        if (!perms.has("viewChannel")) mperms.push("viewchannel");
        if (!perms.has("embedLinks")) mperms.push("embedlinks");
        return `Bot is missing \`${mperms.join(" ,")}\` perms in channel`;
    }



    //check if embed was given or have a default
    var embed;
    if (msg.attachments > 1) {
        embed = await get_embed_attachment(msg);
        if (!embed) return;
    } else if (guilddb.default_embed) {
        embed = guilddb.default_embed;
        
    } else {
        return `No embed set (default or given as a attachment) Please set a default (${msg.prefix}set_dembed) or attach json file of an embed of command`;
    }

    var mcount = parseInt(args[0]);
    if (isNaN(mcount)) return "arg is not a number, please give a number to set the amount of roles to give out";


    var id = String(uuidv4());
    
     
    var Button_not_ready = new ErisComponents.Button()
        .setLabel("Button not ready, Loading")
        .setID(`GR_${id}_notready`)
        .setStyle("red")
        .setDisabled();

    var Button_ready = new ErisComponents.Button()
        .setLabel("Click me for role!")
        .setID(`GR_${id}_ready`)
        .setStyle("blurple");

    var fmsg = await client.sendComponents(cid, Button_not_ready, { embed: await format_embed(embed, 0, mcount) });

    running_givaways[id] = { "mid": fmsg.id, "gid": guilddb.gid, "cid": cid, "rid": rid, "role_count": 0, "role_max": mcount, "finished": false, "members": [], "embed": embed };
    await client.editComponents(fmsg, Button_ready, { embed: await format_embed(embed, 0, mcount) });
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
    await sequelize.sync({ alter: true });

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