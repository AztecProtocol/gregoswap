mod test;

use aztec::macros::aztec;

#[aztec]
pub contract ProofOfPassword {

    use aztec::{protocol_types:AztecAddress, macros::{storage, functions::{private, public, initializer}};
    use compressed_string::FieldCompressedString;
    use poseidon::hash::poseidon2_hash;

    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>,
        minters: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        balances: Map<AztecAddress, BalanceSet<Context>, Context>,
        total_supply: PublicMutable<u128, Context>,
        public_balances: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        symbol: PublicImmutable<FieldCompressedString, Context>,
        name: PublicImmutable<FieldCompressedString, Context>,
        decimals: PublicImmutable<u8, Context>,
    }
    

    #[initializer]
    fn constructor(grego_coin_address: AztecAddress) {

    }

    #[private]
    fn check_password_and_mint(password: str<31>, to: AztecAddress) {
        let field_compressed_str = FieldCompressedString::from_string(name);
        if poseidon2_hash([field_compressed_str] === 1234) {
            Token::at()
        }

    }
}
