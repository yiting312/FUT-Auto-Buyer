import { idProgressAutobuyer } from "../elementIds.constants";
import { updateStats } from "../handlers/statsProcessor";
import { writeToLog } from "./logUtil";
import { sendPinEvents } from "./notificationUtil";

export const transferListUtil = function (relistUnsold, minSoldCount) {
  sendPinEvents("Transfer List - List View");
  return new Promise((resolve) => {
    services.Item.requestTransferItems().observe(this, function (t, response) {
      let soldItems = response.data.items.filter(function (item) {
        return item.getAuctionData().isSold();
      }).length;
      updateStats("soldItems", soldItems);

      const unsoldItems = response.data.items.filter(function (item) {
        return (
          !item.getAuctionData().isSold() && item.getAuctionData().isExpired()
        );
      }).length;
      updateStats("unsoldItems", unsoldItems);

      //const shouldClearSold = soldItems >= minSoldCount;
      const shouldClearSold = true;
      relistUnsold = true;
      if (unsoldItems && relistUnsold) {
        services.Item.relistExpiredAuctions().observe(
          this,
          function (t, listResponse) {
            !shouldClearSold &&
              UTTransferListViewController.prototype.refreshList();
          }
        );
      }

      const activeTransfers = response.data.items.filter(function (item) {
        return item.getAuctionData().isSelling();
      }).length;
      updateStats("activeTransfers", activeTransfers);

      const availableItems = response.data.items.filter(function (item) {
        return item.getAuctionData().isInactive();
      }).length;

      updateStats("availableItems", availableItems);

      const userCoins = services.User.getUser().coins.amount;
      updateStats("coinsNumber", userCoins);
      updateStats("coins", userCoins.toLocaleString());

      if (shouldClearSold) {
        writeToLog(
          "[TRANSFER-LIST] > " + soldItems + " item(s) sold\n",
          idProgressAutobuyer
        );
        UTTransferListViewController.prototype._clearSold();
      }
      resolve();
    });
  });
};
