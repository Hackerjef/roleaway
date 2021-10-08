/*
    Hola, Originaly this joi object schema was from https://github.com/SwitchbladeBot/discord-embed-validator
    specificly src/index.js
    Now you might be wondering why couldn't i just use npm to install it, well the funny thing is that version uses @hapi/joi insted of https://github.com/sideway/joi 
    + a few of the options it has allowed is not allowed by the api for discord embeds, plus missing a few prams that needed to be used. So thats why this is here! :)
    now SwitchbladeBot did not have a license attached to this file
    The license linked to this repo is not assigned to this file but to the original license (no license) of the repo https://github.com/SwitchbladeBot/discord-embed-validator
  */



const Joi = require("joi");

module.exports = Joi.object({
    title: Joi.string().max(256),
    description: Joi.string().max(2048),
    url: Joi.string().uri(),
    timestamp: Joi.string().isoDate(),
    color: Joi.number().integer().min(0).max(16777215),
    footer: Joi.object({
        text: Joi.string().max(2048).required(),
        icon_url: Joi.string().uri(),
    }),
    image: Joi.object({
        url: Joi.string().uri()
    }),
    thumbnail: Joi.object({
        url: Joi.string().uri(),
    }),
    author: Joi.object({
        name: Joi.string().max(256),
        url: Joi.string().uri(),
        icon_url: Joi.string().uri(),
    }),
    fields: Joi.array().items(
        Joi.object({
            name: Joi.string().max(256).required(),
            value: Joi.string().max(1024).required(),
            inline: Joi.boolean()
        })
    ).max(25)
}).custom((embed, helpers) => {
    const sum =
        (embed.title || "").length +
        (embed.description || "").length +
        (embed.fields || []).reduce((previous, current) => {
            return previous + current.name.length + current.value.length;
        }, 0) +
        ((embed.footer || {}).text || "").length +
        ((embed.author || {}).name || "").length;
    if (sum > 6000) {
        return helpers.message("the characters in all title, description, field.name, field.value, footer.text, and author.name fields must not exceed 6000 characters in total");
    } else {
        return embed;
    }
}, "max text length");