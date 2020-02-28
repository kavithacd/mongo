/**
 * Tests that DBClientRS performs re-targeting when it sees an ErrorCodes.NotMaster error response
 * from a command even if "not master" doesn't appear in the message.
 * @tags: [requires_replication]
 */
(function() {
"use strict";

// Set the refresh period to 10 min to rule out races
_setShellFailPoint({
    configureFailPoint: "modifyReplicaSetMonitorDefaultRefreshPeriod",
    mode: "alwaysOn",
    data: {
        period: 10 * 60,
    },
});

const rst = new ReplSetTest({
    nodes: 3,
    nodeOptions: {
        setParameter:
            {"failpoint.respondWithNotPrimaryInCommandDispatch": tojson({mode: "alwaysOn"})}
    }
});
rst.startSet();
rst.initiate();

const directConn = rst.getPrimary();
const rsConn = new Mongo(rst.getURL());
assert(rsConn.isReplicaSetConnection(),
       "expected " + rsConn.host + " to be a replica set connection string");

function stepDownPrimary(rst) {
    const awaitShell = startParallelShell(
        () => assert.commandWorked(db.adminCommand({replSetStepDown: 60, force: true})),
        directConn.port);

    // We wait for the primary to transition to the SECONDARY state to ensure we're waiting
    // until after the parallel shell has started the replSetStepDown command.
    const reconnectNode = false;
    rst.waitForState(directConn, ReplSetTest.State.SECONDARY, null, reconnectNode);

    return awaitShell;
}

const awaitShell = stepDownPrimary(rst);

// Wait for a new primary to be elected and agreed upon by nodes.
rst.getPrimary();
rst.awaitNodesAgreeOnPrimary();

// DBClientRS will continue to send command requests to the node it believed to be primary even
// after it stepped down so long as it hasn't closed its connection.
assert.commandFailedWithCode(rsConn.getDB("test").runCommand({create: "mycoll"}),
                             ErrorCodes.NotMaster);

// However, once the server responds back with a ErrorCodes.NotMaster error, DBClientRS will
// cause the ReplicaSetMonitor to attempt to discover the current primary.
assert.commandWorked(rsConn.getDB("test").runCommand({create: "mycoll"}));

awaitShell();

rst.stopSet();
})();
