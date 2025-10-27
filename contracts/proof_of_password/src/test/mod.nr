use dep::Token;
use aztec::{
    protocol_types::address::AztecAddress, test::helpers::test_environment::TestEnvironment,
};

pub unconstrained fn setup(
) -> (TestEnvironment, AztecAddress, AztecAddress, AztecAddress) {
    // Setup env, generate keys
    let mut env = TestEnvironment::new();

    let owner = env.create_light_account();
    let recipient = env.create_light_account();

    // Deploy token contract
    let initializer_call_interface = Token::interface().constructor(
        owner,
        "TestToken0000000000000000000000",
        "TT00000000000000000000000000000",
        18,
    );
    let token_contract_address =
        env.deploy("./target/token_contract-Token.json", "Token").with_public_initializer(owner, initializer_call_interface);

    

    (env, token_contract_address, owner, recipient)
}
