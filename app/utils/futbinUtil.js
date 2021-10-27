import { idAutoBuyerFoundLog } from "../elementIds.constants";
import { getValue, setValue } from "../services/repository";
import { networkCallWithRetry } from "./commonUtil";
import { writeToLog } from "./logUtil";
import { getBuyBidPrice, roundOffPrice } from "./priceUtils";
import { getUserPlatform } from "./userUtil";

export const fetchPricesFromFutBin = (definitionId, retries) => {
  if (getValue(definitionId)) {
    return new Promise((resolve, reject) => {
      resolve(getValue(definitionId));
    });
  }
  return networkCallWithRetry(
    fetchPrices.bind(null, definitionId),
    0.5,
    retries
  );
};

export const getSellPriceFromFutBin = async (
  buyerSetting,
  playerName,
  player
) => {
  let sellPrice;
  try {
    const definitionId = player.definitionId;
    const futBinResponse = await fetchPricesFromFutBin(definitionId, 3);
    if (futBinResponse.status === 200) {
      const futBinPrices = JSON.parse(futBinResponse.responseText);
      sellPrice = parseInt(
        futBinPrices[definitionId].prices[getUserPlatform()].LCPrice.replace(
          /[,.]/g,
          ""
        )
      );
      const futBinPercent = buyerSetting["idSellFutBinPercent"] || 100;
      let calculatedPrice = roundOffPrice((sellPrice * futBinPercent) / 100);
      await getPriceLimits(player);
      if (player.hasPriceLimits()) {
        calculatedPrice = Math.min(
          player._itemPriceLimits.maximum,
          Math.max(player._itemPriceLimits.minimum, calculatedPrice)
        );

        if (calculatedPrice === player._itemPriceLimits.minimum) {
          calculatedPrice = getBuyBidPrice(calculatedPrice);
        }
      }
      writeToLog(
        `= Futbin price for ${playerName}: ${sellPrice}: ${futBinPercent}% of sale price: ${calculatedPrice}`,
        idAutoBuyerFoundLog
      );
      sellPrice = calculatedPrice;
    } else {
      sellPrice = null;
      writeToLog(
        `= Unable to get Futbin price for ${playerName}`,
        idAutoBuyerFoundLog
      );
    }
  } catch (err) {
    err = err.statusText || err.status || err;
    sellPrice = null;
    writeToLog(
      `= Unable to get Futbin price for ${playerName}, err: ${
        err || "error occured"
      }`,
      idAutoBuyerFoundLog
    );
  }
  return sellPrice;
};

const fetchPrices = (definitionId) => {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://www.futbin.com/22/playerPrices?player=${definitionId}`,
      onload: (res) => {
        if (res.status === 200) {
          res.expiryTimeStamp = new Date(Date.now() + 15 * 60 * 1000);
          setValue(definitionId, res);
          resolve(res);
        } else {
          reject(res);
        }
      },
    });
  });
};

const getPriceLimits = async (player) => {
  return new Promise((resolve) => {
    if (player.hasPriceLimits()) {
      resolve();
      return;
    }
    services.Item.requestMarketData(player).observe(
      this,
      async function (sender, response) {
        resolve();
      }
    );
  });
};

export const fetchPricesFromFutBinNew = async (definitionId, refIds, retries) => {
  return networkCallWithRetry(
    fetchPricesNew.bind(null, definitionId, refIds),
    0.5,
    retries
  );
};

const fetchPricesNew = async (definitionId, refIds) => {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: "GET",
      url: `https://www.futbin.com/22/playerPrices?player=${definitionId}&rids=${refIds}`,
      onload: (res) => {
        if (res.status === 200) {
          resolve(res);
        } else {
          reject(res);
        }
      },
    });
  });
};

export const fetchPricesFromFutBinBulk = async (
  playersIdArray,
  platform
) => {
  let resultJSON;
  try{
    const playerIdLookup = new Set(playersIdArray);
    const playerId = playersIdArray.shift();
    const refIds = playersIdArray.join(",");
    const futBinResponse = await fetchPricesFromFutBinNew(playerId, refIds, 5);
    if (futBinResponse.status === 200) {
      resultJSON = JSON.parse(futBinResponse.responseText);
      const futBinPrices = JSON.parse(futBinResponse.responseText);
      //store futbinPrice in repository
      for (let definitionId of playerIdLookup){
        let futbinLessPrice =
          futBinPrices[definitionId] && 
          parseInt(futBinPrices[definitionId].prices[platform].LCPrice);
          if (futBinPrices){
            continue;
          }
          const cacheValue = {
          expiryTimeStamp: new Date(Date.now() + 15 * 60 * 1000),
          price: futbinLessPrice,
        };
        setValue(definitionId, cacheValue);
      }
    }else{
      writeToLog(
        `= Unable to get Futbin price for err: http fail"
        }`,
        idAutoBuyerFoundLog
      );
      resultJSON = null;
    }
  }catch(err){
    err = err.statusText || err.status || err;
    resultJSON = null;
    writeToLog(
      `= Unable to get Futbin price for err: ${
        err || "error occured"
      }`,
      idAutoBuyerFoundLog
    );
  }
  return resultJSON;
};

