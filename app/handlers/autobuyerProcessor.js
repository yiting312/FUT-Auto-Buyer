import { getSellPriceFromFutBin,fetchPricesFromFutBinBulk } from "../utils/futbinUtil";
import { idAbStatus, idAutoBuyerFoundLog } from "../elementIds.constants";
import { trackMarketPrices } from "../services/analytics";
import {
  getValue,
  increAndGetStoreValue,
  setValue,
} from "../services/repository";
import {
  pauseBotIfRequired,
  stopBotIfRequired,
  switchFilterIfRequired,
} from "../utils/autoActionsUtil";
import {
  convertToSeconds,
  formatString,
  getRandNum,
  getRangeValue,
  playAudio,
} from "../utils/commonUtil";
import { writeToDebugLog, writeToLog } from "../utils/logUtil";
import { sendPinEvents, sendUINotification } from "../utils/notificationUtil";
import {
  getBuyBidPrice,
  getSellBidPrice,
  roundOffPrice,
} from "../utils/priceUtils";
import { buyPlayer, checkRating } from "../utils/purchaseUtil";
import { updateRequestCount } from "../utils/statsUtil";
import { setRandomInterval } from "../utils/timeOutUtil";
import { transferListUtil } from "../utils/transferlistUtil";
import { getUserPlatform } from "../utils/userUtil";
import { addUserWatchItems, watchListUtil } from "../utils/watchlistUtil";
import { searchErrorHandler } from "./errorHandler";

let interval = null;
let passInterval = null;
let isOnlyWatch = true;
let needTransferList = false;
let needSearchFutMarket = false;
const currentBids = new Set();

export const startAutoBuyer = async function (isResume) {
  $("#" + idAbStatus)
    .css("color", "#2cbe2d")
    .html("RUNNING");

  const isActive = getValue("autoBuyerActive");
  if (isActive) return;
  sendUINotification(isResume ? "Autobuyer Resumed" : "Autobuyer Started");
  setValue("autoBuyerActive", true);
  setValue("autoBuyerState", "Active");
  if (!isResume) {
    setValue("isOnlyWatch", isOnlyWatch);
    setValue("needTransferList", needTransferList);
    setValue("needSearchFutMarket", needSearchFutMarket);
    setValue("botStartTime", new Date());
    setValue("purchasedCardCount", 0);
    setValue("searchFailedCount", 0);
    setValue("currentPage", 1);
  }
  let pauseBotWithContext = pauseBotIfRequired.bind(this);
  let switchFilterWithContext = switchFilterIfRequired.bind(this);
  let watchListWithContext = watchListUtil.bind(this);
  let transferListWithContext = transferListUtil.bind(this);
  let srchTmWithContext = searchTransferMarket.bind(this);
  await switchFilterWithContext();
  let buyerSetting = getValue("BuyerSettings");
  !isResume && (await addUserWatchItems());
  // sendPinEvents("Hub - Transfers");
  // await srchTmWithContext(buyerSetting);
  // sendPinEvents("Hub - Transfers");
  // await transferListWithContext(
  //   buyerSetting["idAbSellToggle"],
  //   buyerSetting["idAbMinDeleteCount"],
  //   true
  // );
  interval = setRandomInterval(async () => {
    passInterval = pauseBotWithContext(buyerSetting);
    stopBotIfRequired(buyerSetting);
    const isBuyerActive = getValue("autoBuyerActive");
    if (isBuyerActive) {
      await switchFilterWithContext();
      buyerSetting = getValue("BuyerSettings");
      if (isOnlyWatch){
        sendPinEvents("Hub - Transfers");
        await watchListWithContext(buyerSetting);
      }else if(needTransferList){
        sendPinEvents("Hub - Transfers");
        await transferListWithContext(
          buyerSetting["idAbSellToggle"],
          buyerSetting["idAbMinDeleteCount"]
        );
        refreshActionStates(false, false, true);
      }else if(needSearchFutMarket){
        sendPinEvents("Hub - Transfers");
        await srchTmWithContext(buyerSetting);
        refreshActionStates(true, false, false);
      }
    }
  }, ...getRangeValue(buyerSetting["idAbWaitTime"]));
};

export const refreshActionStates = function (watchAction, transferAction, searchFutAction) {
  isOnlyWatch = watchAction;
  needTransferList = transferAction;
  needSearchFutMarket = searchFutAction;
  setValue("isOnlyWatch", isOnlyWatch);
  setValue("needTransferList", needTransferList);
  setValue("needSearchFutMarket", needSearchFutMarket);
};

export const stopAutoBuyer = (isPaused) => {
  interval && interval.clear();
  if (!isPaused && passInterval) {
    clearTimeout(passInterval);
  }
  const isActive = getValue("autoBuyerActive");
  if (!isActive) return;
  setValue("autoBuyerActive", false);
  setValue("searchInterval", {
    ...getValue("searchInterval"),
    end: Date.now(),
  });
  if (!isPaused) {
    playAudio("finish");
  }
  setValue("autoBuyerState", isPaused ? "Paused" : "Stopped");
  sendUINotification(isPaused ? "Autobuyer Paused" : "Autobuyer Stopped");
  $("#" + idAbStatus)
    .css("color", "red")
    .html(isPaused ? "PAUSED" : "IDLE");
};

//TODO
const searchTransferMarket = function (buyerSetting) {
  const platform = getUserPlatform();
  return new Promise((resolve) => {
    sendPinEvents("Transfer Market Search");
    updateRequestCount();
    let searchCriteria = this._viewmodel.searchCriteria;

    services.Item.clearTransferMarketCache();

    const expiresIn = convertToSeconds(buyerSetting["idAbItemExpiring"]);
    const useRandMinBid = buyerSetting["idAbRandMinBidToggle"];
    const useRandMinBuy = buyerSetting["idAbRandMinBuyToggle"];
    let currentPage = getValue("currentPage") || 1;
    if (useRandMinBid)
      searchCriteria.minBid = roundOffPrice(
        getRandNum(0, buyerSetting["idAbRandMinBidInput"])
      );
    if (useRandMinBuy)
      searchCriteria.minBuy = roundOffPrice(
        getRandNum(0, buyerSetting["idAbRandMinBuyInput"])
      );
    services.Item.searchTransferMarket(searchCriteria, currentPage).observe(
      this,
      async function (sender, response) {
        if (response.success) {
          setValue("searchFailedCount", 0);
          let validSearchCount = true;
          writeToLog(
            `= Received ${response.data.items.length} items - from page (${currentPage}) => config: (minbid: ${searchCriteria.minBid}-minbuy:${searchCriteria.minBuy})`,
            idAutoBuyerFoundLog
          );

          if (response.data.items.length > 0) {
            writeToLog(
              "| rating   | player name     | bid    | buy    | time            | action",
              idAutoBuyerFoundLog
            );
            currentPage === 1 &&
              sendPinEvents("Transfer Market Results - List View");
          }

          if (response.data.items.length > buyerSetting["idAbSearchResult"]) {
            validSearchCount = false;
          }

          let maxPurchases = buyerSetting["idAbMaxPurchases"];
          const auctionPrices = [];

          if (
            currentPage < buyerSetting["idAbMaxSearchPage"] &&
            response.data.items.length === 21
          ) {
            increAndGetStoreValue("currentPage");
          } else {
            setValue("currentPage", 1);
          }

          const playersId = new Set();
          for (let i = response.data.items.length - 1; i >= 0; i--) {
            let player = response.data.items[i];
            playersId.add(player.definitionId);
          }
          const playersIdArray = Array.from(playersId);
          let pricesJSON = await fetchPricesFromFutBinBulk(
            playersIdArray,
            platform
          );
          
          //logWrite("skip >>> (can not find futbin price)");


          for (let i = response.data.items.length - 1; i >= 0; i--) {
            let player = response.data.items[i];
            if (!pricesJSON[player.definitionId]) {
              logWrite("skip >>> (can not find futbin price)");
              continue;
            }
            let auction = player._auction;
            let type = player.type;
            let playerRating = parseInt(player.rating);
            let expires = services.Localization.localizeAuctionTimeRemaining(
              auction.expires
            );

            if (type === "player") {
              const { trackPayLoad } = formRequestPayLoad(player, platform);

              auctionPrices.push(trackPayLoad);
            }

            let buyNowPrice = auction.buyNowPrice;
            let currentBid = auction.currentBid || auction.startingBid;
            let isBid = auction.currentBid;

            let playerName = formatString(player._staticData.name, 15);

            
            
            
         

            //TODO--get threshold from fut-enhancer
            // let idBarginThreshold = enhancerSetting["idBarginThreshold"]
            // writeToLog(
            //   `fidBarginThreshold:${idBarginThreshold})`,
            //   idAutoBuyerFoundLog
            // );


            let bidPrice = buyerSetting["idAbMaxBid"];
            let funbinPrice = parseInt(pricesJSON[player.definitionId].prices[platform].LCPrice);
            if (!funbinPrice||(funbinPrice==null)){
              logWrite("skip >>> cant get futbin price");
              continue;
            }
            //logWrite('skip >>> cant get futbin price${funbinPrice}'+funbinPrice);
            let calculatedPrice = roundOffPrice((funbinPrice * 65) / 100);
            if (!calculatedPrice) {
              logWrite("skip >>> cant get futbin price");
              continue;
            }
            if (bidPrice > calculatedPrice){
              bidPrice = calculatedPrice;
            }
            

            let priceToBid = buyerSetting["idAbBidExact"]
              ? bidPrice
              : isBid
              ? getSellBidPrice(bidPrice)
              : bidPrice;

            let checkPrice = buyerSetting["idAbBidExact"]
              ? priceToBid
              : isBid
              ? getBuyBidPrice(currentBid)
              : currentBid;

            let userBuyNowPrice = buyerSetting["idAbBuyPrice"];
            let usersellPrice = buyerSetting["idAbSellPrice"];
            let minRating = buyerSetting["idAbMinRating"];
            let maxRating = buyerSetting["idAbMaxRating"];

            let bidTxt = formatString(currentBid.toString(), 6);
            let buyTxt = formatString(buyNowPrice.toString(), 6);
            //let playerName = formatString(player._staticData.name, 15);
            let expireTime = formatString(expires, 15);

            const shouldCheckRating = minRating || maxRating;

            const isValidRating =
              !shouldCheckRating ||
              checkRating(playerRating, minRating, maxRating);
            const ratingTxt = !isValidRating ? "no" : "ok";

            const logWrite = writeToLogClosure(
              "(" + playerRating + "-" + ratingTxt + ") ",
              playerName,
              bidTxt,
              buyTxt,
              expireTime
            );

            if (!validSearchCount) {
              logWrite("skip >>> (Exceeded search result threshold)");
              continue;
            }

            if (maxPurchases < 1) {
              logWrite("skip >>> (Exceeded num of buys/bids per search)");
              continue;
            }

            if (!userBuyNowPrice && !bidPrice) {
              logWrite("skip >>> (No Buy or Bid Price given)");
              continue;
            }

            if (!player.preferredPosition && buyerSetting["idAbAddFilterGK"]) {
              logWrite("skip >>> (is a Goalkeeper)");
              continue;
            }

            if (!isValidRating) {
              logWrite("skip >>> (rating does not fit criteria)");
              continue;
            }

            if (currentBids.has(auction.tradeId)) {
              logWrite("skip >>> (Cached Item)");
              continue;
            }

            const userCoins = services.User.getUser().coins.amount;
            if (
              userCoins < buyNowPrice ||
              (bidPrice && userCoins < checkPrice)
            ) {
              logWrite("skip >>> (Insufficient coins to buy/bid)");
              continue;
            }

            if (buyNowPrice <= userBuyNowPrice) {
              logWrite("attempt buy: " + buyNowPrice);
              maxPurchases--;
              currentBids.add(auction.tradeId);  
              await buyPlayer(
                player,
                playerName,
                buyNowPrice,
                usersellPrice,
                true,
                auction.tradeId
              );
              continue;
            }

            if (bidPrice && currentBid <= priceToBid) {
              if (auction.expires > expiresIn) {
                logWrite("skip >>> (Waiting for specified expiry time)");
                continue;
              }
              logWrite("attempt bid: " + checkPrice);
              currentBids.add(auction.tradeId);
              maxPurchases--;
              await buyPlayer(
                player,
                playerName,
                checkPrice,
                usersellPrice,
                checkPrice === buyNowPrice,
                auction.tradeId
              );
              continue;
            }

            if (
              (userBuyNowPrice && buyNowPrice > userBuyNowPrice) ||
              (bidPrice && currentBid > priceToBid)
            ) {
              logWrite("skip >>> (higher than specified buy/bid price)");
              continue;
            }

            logWrite("skip >>> (No Actions Required)");
          }
          if (auctionPrices.length && auctionPrices.length < 12) {
            trackMarketPrices(auctionPrices);
          }
        } else {
          searchErrorHandler(
            response,
            buyerSetting["idAbSolveCaptcha"],
            buyerSetting["idAbCloseTabToggle"]
          );
        }
        sendPinEvents("Transfer Market Search");
        resolve();
      }
    );
  });
};

const formRequestPayLoad = (player, platform) => {
  const {
    id,
    definitionId,
    _auction: { buyNowPrice, tradeId: auctionId, expires: expiresOn },
    _metaData: { id: assetId } = {},
    rareflag,
    playStyle,
  } = player;

  const expireDate = new Date();
  expireDate.setSeconds(expireDate.getSeconds() + expiresOn);
  const trackPayLoad = {
    definitionId,
    price: buyNowPrice,
    expiresOn: expireDate,
    id: id + "",
    assetId: assetId + "_" + platform + "_" + rareflag,
    auctionId,
    year: 22,
    updatedOn: new Date(),
    playStyle,
  };

  return { trackPayLoad };
};

const writeToLogClosure = (
  ratingTxt,
  playerName,
  bidTxt,
  buyTxt,
  expireTime
) => {
  return (actionTxt) => {
    writeToDebugLog(
      ratingTxt,
      playerName,
      bidTxt,
      buyTxt,
      expireTime,
      actionTxt
    );
  };
};
