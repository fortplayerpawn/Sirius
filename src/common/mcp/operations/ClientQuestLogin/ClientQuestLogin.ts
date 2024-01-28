import { Response, Request } from "express";
import { DateTime } from "luxon";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import Accounts from "../../../../models/Accounts";
import { getProfile } from "../../utils/getProfile";
import log from "../../../../utils/log";
import { getSeason } from "../../../../utils";

interface RandomQuest {
  templateId: string;
  objectives: { [key: string]: string };
}

export default async function ClientQuestLogin(
  res: Response,
  req: Request,
  accountId: string,
  profileId: string
) {
  try {
    const dailyQuestsPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "resources",
      "quests",
      "DailyQuests.json"
    );
    const dailyQuestsData = fs.readFileSync(dailyQuestsPath, "utf-8");
    const dailyQuests: RandomQuest[] = JSON.parse(dailyQuestsData);

    const userProfiles: any = await getProfile(accountId);
    const account = await Accounts.findOne({ accountId });

    const season = getSeason(req.headers["user-agent"]);

    let shouldGrantQuest: boolean = true;

    if (!account) {
      return res.status(404).json({ error: "Failed to find Account." });
    }

    let dailyQuestRerolls =
      userProfiles.stats.attributes.quest_manager?.dailyQuestRerolls;

    const lastLoginDateISO =
      userProfiles.stats.attributes.quest_manager?.dailyLoginInterval;
    const lastLoginDate = lastLoginDateISO
      ? DateTime.fromISO(lastLoginDateISO)
      : null;

    if (lastLoginDateISO) {
      const today = DateTime.now().toISODate();

      if (lastLoginDate?.hasSame(DateTime.now(), "day")) {
        shouldGrantQuest = true;
      } else {
        shouldGrantQuest = true;

        if (dailyQuestRerolls <= 0) {
          dailyQuestRerolls += 1;
        }
      }
    }

    const existingTemplateIds = new Set(
      Object.values(userProfiles.items)
        .filter((quest: any) => quest.templateId)
        .map((quest: any) => quest.templateId.toLowerCase())
    );

    const questsToAdd = dailyQuests.filter(
      (quest: RandomQuest) =>
        !existingTemplateIds.has(quest.templateId.toLowerCase())
    );

    const selectedQuests = questsToAdd.slice(
      0,
      Math.min(3, questsToAdd.length)
    );

    const multiUpdates: any[] = [];

    selectedQuests.forEach((randomQuest: RandomQuest) => {
      const questId = uuid();
      userProfiles.items[questId] = {
        templateId: randomQuest.templateId,
        attributes: {
          creation_time: DateTime.now().toISO(),
          level: -1,
          item_seen: false,
          playlists: [],
          sent_new_notification: false,
          challenge_bundle_id: "",
          xp_reward_scalar: 1,
          challenge_linked_quest_given: "",
          quest_pool: "",
          quest_state: "Active",
          bucket: "",
          last_state_change_time: DateTime.now().toISO(),
          challenge_linked_quest_parent: "",
          max_level_bonus: 0,
          xp: 15000,
          quest_rarity: "uncommon",
          favorite: false,
        },
        quantity: 1,
      };

      for (const objKey in randomQuest.objectives) {
        const objValue = randomQuest.objectives[objKey];
        userProfiles.items[questId].attributes[
          `completion_${objValue.toLowerCase()}`
        ] = 0;
      }

      multiUpdates.push({
        changeType: "itemAdded",
        itemId: questId,
        item: userProfiles.items[questId],
      });
    });

    const questManager = userProfiles.stats.attributes.quest_manager;
    questManager.dailyLoginInterval = DateTime.now().toISO();
    questManager.dailyQuestRerolls = 1;

    multiUpdates.push({
      changeType: "statModified",
      name: "quest_manager",
      value: questManager,
    });

    for (const quest in userProfiles.items) {
      if (userProfiles.items.hasOwnProperty(quest)) {
        const questParts: string[] = quest.split("");

        if (quest.startsWith(`${season?.season}`)) continue;

        if (
          questParts.length === 4 &&
          questParts[0] === "S" &&
          !isNaN(parseInt(questParts[1])) &&
          questParts[2] === "-" &&
          !isNaN(parseInt(questParts[2]))
        ) {
          delete userProfiles.items[quest];

          multiUpdates.push({
            changeType: "itemRemoved",
            itemId: quest,
          });
        }
      }
    }

    if (multiUpdates.length > 0) {
      userProfiles.rvn += 1;
      userProfiles.commandRevision += 1;
      userProfiles.Updated = DateTime.now().toISO();
    }

    res.json({
      profileRevision: userProfiles.rvn || 0,
      profileId: "athena",
      profileChangesBaseRevision: account.baseRevision || 0,
      profileChanges: multiUpdates,
      profileCommandRevision: userProfiles.commandRevision || 0,
      serverTime: DateTime.now().toISO(),
      responseVersion: 1,
    });

    if (multiUpdates.length > 0) {
      await account.updateOne({ $set: { athena: userProfiles } });
    }
  } catch (error) {
    log.error(`An error occurred: ${error}`, "ClientQuestLogin");
    res.status(500).json({ error: "Internal server error." });
  }
}
