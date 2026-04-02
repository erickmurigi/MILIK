import React from "react";
import Statements from "./Statements";

// Preserve the familiar "Commission & L.L Statements" route while using the unified ledger workflow.
const LandlordCommissionsStatement = () => {
  return <Statements legacyEntry />;
};

export default LandlordCommissionsStatement;
